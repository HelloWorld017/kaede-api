{ lib, stdenv, fetchurl, gzip, patchelf, zlib, openssl }:
let
  version = "1.20261025.1";

  sources = {
    x86_64-linux = {
      asset = "workerd-linux-64.gz";
      hash = "sha256-NGZnFwQCKeoUPFKc1ieyzxlaT0+ATbIBsiRPoRDlDyI=";
    };

    aarch64-linux = {
      asset = "workerd-linux-arm64.gz";
      hash = "sha256-nnf3sXBQ3Ns9BCGLQv0XEqUSUDjcKkPDlGXa/ZoJG9M=";
    };
  };

  srcInfo =
    sources.${stdenv.hostPlatform.system}
      or (throw "Unsupported system: ${stdenv.hostPlatform.system}");

  runtimeLibs = [
    stdenv.cc.cc.lib
    stdenv.cc.libc
    zlib
    openssl
  ];
in

stdenv.mkDerivation {
  pname = "workerd-patched";
  inherit version;

  src = fetchurl {
    url = "https://github.com/cloudflare/workerd/releases/download/v${version}/${srcInfo.asset}";
    hash = srcInfo.hash;
  };

  dontUnpack = true;

  nativeBuildInputs = [
    gzip
    patchelf
  ];

  installPhase = ''
    runHook preInstall

    mkdir -p $out/bin
    gzip -dc "$src" > $out/bin/workerd
    chmod +x $out/bin/workerd

    runHook postInstall
  '';

  postFixup = ''
    patchelf \
      --set-interpreter ${stdenv.cc.bintools.dynamicLinker} \
      --set-rpath ${lib.makeLibraryPath runtimeLibs} \
      $out/bin/workerd

    patchelf --print-interpreter $out/bin/workerd
    patchelf --print-rpath $out/bin/workerd
  '';
}
