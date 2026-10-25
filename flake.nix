{
  description = "Kaede API — workerd, Hono and SQLite";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs = { nixpkgs, ... }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
      perSystem = system:
        let
          pkgs = import nixpkgs { inherit system; };
          name = "kaede-api";
          metadata = builtins.fromJSON (builtins.readFile ./package.json);
          inherit (pkgs) pnpm;
          workerd = pkgs.callPackage ./build/workerd.nix {};
          app = pkgs.stdenvNoCC.mkDerivation (finalAttrs: {
            pname = "${name}-app";
            version = metadata.version;
            src = pkgs.lib.cleanSourceWith {
              src = ./.;
              filter = path: type:
                let base = builtins.baseNameOf path;
                in !(builtins.elem base [ ".git" "node_modules" "dist" "data" "result" ])
                  && !(pkgs.lib.hasPrefix ".env" base);
            };
            pnpmDeps = pkgs.fetchPnpmDeps {
              inherit (finalAttrs) version;
              src = pkgs.lib.fileset.toSource {
                root = ./.;
                fileset = pkgs.lib.fileset.unions [ ./package.json ./pnpm-lock.yaml ./pnpm-workspace.yaml ];
              };
              inherit pnpm;
              pname = "${name}-deps";
              fetcherVersion = 5;
              prePnpmInstall = ''
                export pnpm_config_force_ignores_platform=false
              '';
              hash = "sha256-gpZHfL4F7muLGQNUQQtut4tq8DjzoqqZh4BSMitcrTM=";
            };
            nativeBuildInputs = [ pkgs.nodejs pnpm pkgs.pnpmConfigHook pkgs.autoPatchelfHook ];
            buildInputs = [ pkgs.stdenv.cc.cc.lib ];
            preBuild = ''
              autoPatchelf node_modules
            '';
            buildPhase = ''
              runHook preBuild
              pnpm check
              pnpm build
              runHook postBuild
            '';
            installPhase = ''
              mkdir -p "$out/share/${name}"
              cp dist/backend.bundle.js "$out/share/${name}/"
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
            contents = with pkgs.dockerTools; [ caCertificates fakeNss ];
            extraCommands = ''
              mkdir -p data tmp
              chmod 1777 tmp
            '';
            config = {
              Entrypoint = [ "${entrypoint}/bin/${name}" ];
              Env = [ "BACKEND_SQLITE_PATH=/data" "PORT=11005" ];
              ExposedPorts."11005/tcp" = {};
              Volumes."/data" = {};
              Labels = {
                "org.opencontainers.image.title" = name;
                "org.opencontainers.image.source" = metadata.repository;
                "org.opencontainers.image.version" = metadata.version;
                "org.opencontainers.image.licenses" = metadata.license;
              };
            };
          };
        in {
          packages = { default = entrypoint; inherit app image pnpm workerd; };
          devShell = pkgs.mkShell { packages = [ pkgs.nodejs pnpm workerd entrypoint ]; };
        };
    in {
      packages = forAllSystems (system: (perSystem system).packages);
      devShells = forAllSystems (system: { default = (perSystem system).devShell; });
    };
}
