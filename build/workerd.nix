{ lib, stdenv, fetchurl, gzip, patchelf, zlib, openssl }:
let
  version = "1.20261025.1";
  source = {
    x86_64-linux = {
      asset = "workerd-linux-64.gz";
      hash = "sha256-NGZnFwQCKeoUPFKc1ieyzxlaT0+ATbIBsiRPoRDlDyI=";
    };
    aarch64-linux = {
      asset = "workerd-linux-arm64.gz";
      hash = "sha256-nnf3sXBQ3Ns9BCGLQv0XEqUSUDjcKkPDlGXa/ZoJG9M=";
    };
  }.${stdenv.hostPlatform.system};
in stdenv.mkDerivation {
  pname = "workerd";
  inherit version;
  src = fetchurl {
    url = "https://github.com/cloudflare/workerd/releases/download/v${version}/${source.asset}";
    inherit (source) hash;
  };
  dontUnpack = true;
  nativeBuildInputs = [ gzip patchelf ];
  installPhase = ''
    mkdir -p "$out/bin"
    gzip -dc "$src" > "$out/bin/workerd"
    chmod +x "$out/bin/workerd"
  '';
  postFixup = ''
    patchelf --set-interpreter ${stdenv.cc.bintools.dynamicLinker} \
      --set-rpath ${lib.makeLibraryPath [ stdenv.cc.cc.lib stdenv.cc.libc zlib openssl ]} \
      "$out/bin/workerd"
  '';
  meta.mainProgram = "workerd";
}
