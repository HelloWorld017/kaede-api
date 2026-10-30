{
  inputs = {
    nixpkgs = {
      url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    };
  };

  outputs = { nixpkgs, ... }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
      perSystem = system:
        let
          pkgs = import nixpkgs { inherit system; };
          name = "kaede-api";
          metadata = builtins.fromJSON (builtins.readFile ./package.json);
          nodejs = pkgs.nodejs_26;
          workerd = pkgs.callPackage ./build/workerd.nix {};
          genpassword = pkgs.writeShellScriptBin "genpassword" ''
            set -euo pipefail
            read -r -s -p 'Admin password: ' PASSWORD
            printf '\n' >&2
            export PASSWORD
            exec ${workerd}/bin/workerd test ${./backend.capnp} 'passwordConfig:genpassword:*' \
              --import-path ${app}/share/${name} "$@"
          '';

          app = pkgs.stdenvNoCC.mkDerivation (finalAttrs: {
            pname = "${name}-app";
            version = metadata.version;
            src = ./.;

            pnpmDeps = pkgs.fetchPnpmDeps {
              inherit (finalAttrs) version src;
              pnpm = pkgs.pnpm;
              pname = "${name}-deps";
              fetcherVersion = 5;
              hash = "sha256-0vslkZRFk/rFUV1m+Vsj8+YVwbZJSedq9gUNh75i8aw=";
            };

            nativeBuildInputs = [
              nodejs
              pkgs.pnpm
              pkgs.pnpmConfigHook
              pkgs.autoPatchelfHook
            ];

            buildPhase = ''
              runHook preBuild
              pnpm check
              pnpm build
              runHook postBuild
            '';

            installPhase = ''
              mkdir -p "$out/share/${name}"
              cp dist/backend.bundle.js "$out/share/${name}/"
              cp dist/password.bundle.js "$out/share/${name}/"
            '';
          });

          entrypoint = pkgs.writeShellScriptBin name ''
            set -euo pipefail
            export BACKEND_SQLITE_PATH="''${BACKEND_SQLITE_PATH:-./data}"
            ${pkgs.coreutils}/bin/mkdir -p "$BACKEND_SQLITE_PATH"
            exec ${workerd}/bin/workerd serve ${./backend.capnp} config \
              --import-path ${app}/share/${name} \
              --directory-path "do-storage=$BACKEND_SQLITE_PATH" \
              --socket-addr "http=*:''${PORT:-11005}" "$@"
          '';

          image = pkgs.dockerTools.buildLayeredImage {
            inherit name;
            tag = "latest";
            contents = with pkgs.dockerTools; [
              caCertificates
              binSh
              fakeNss
              usrBinEnv
              genpassword
            ];

            extraCommands = ''
              mkdir -p data tmp
              chmod 1777 tmp
            '';

            config = {
              Entrypoint = [ "${entrypoint}/bin/${name}" ];
              Env = [
                "BACKEND_SQLITE_PATH=/data"
                "PORT=11005"
                "SSL_CERT_FILE=/etc/ssl/certs/ca-bundle.crt"
              ];
              ExposedPorts = { "11005/tcp" = {}; };
              Volumes = { "/data" = {}; };
            };
          };
        in {
          packages = {
            default = pkgs.symlinkJoin {
              inherit name;
              paths = [ entrypoint genpassword ];
            };
            inherit image genpassword;
          };

          devShell = pkgs.mkShell {
            packages = [
              nodejs
              pkgs.pnpm
              workerd
              genpassword
            ];
          };
        };
    in {
      packages = forAllSystems (system: (perSystem system).packages);
      devShells = forAllSystems (system: { default = (perSystem system).devShell; });
    };
}
