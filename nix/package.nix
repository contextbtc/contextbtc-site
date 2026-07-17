{ lib
, stdenvNoCC
, bun
, nodejs
,
}:

let
  pname = "contextbtc-site";
  version = "0.0.1";

  depsSrc = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.unions [
      ../package.json
      ../bun.lock
    ];
  };

  siteSrc = lib.fileset.toSource {
    root = ../.;
    fileset = lib.fileset.difference ../. (lib.fileset.unions [
      (lib.fileset.maybeMissing ../node_modules)
      (lib.fileset.maybeMissing ../build)
      (lib.fileset.maybeMissing ../.svelte-kit)
      (lib.fileset.maybeMissing ../wallet-wasm/target)
      (lib.fileset.maybeMissing ../result)
    ]);
  };

  nodeModules = stdenvNoCC.mkDerivation {
    pname = "${pname}-node-modules";
    inherit version;
    src = depsSrc;

    nativeBuildInputs = [ bun ];

    dontConfigure = true;

    buildPhase = ''
      runHook preBuild

      export HOME=$TMPDIR
      export BUN_INSTALL_CACHE_DIR=$TMPDIR/bun-cache
      bun install \
        --frozen-lockfile \
        --no-progress \
        --ignore-scripts

      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall
      mkdir -p $out
      cp -R node_modules $out/node_modules
      runHook postInstall
    '';

    dontFixup = true;

    outputHashMode = "recursive";
    outputHashAlgo = "sha256";
    # Update whenever bun.lock changes: set to lib.fakeHash, rebuild, copy the
    # "got:" hash Nix reports.
    outputHash = "sha256-FWLTI6NM+Dou+4bsBxupZFMLNXrIxpgB0jpBRhSW/h8=";
  };
in
stdenvNoCC.mkDerivation {
  inherit pname version;
  src = siteSrc;

  nativeBuildInputs = [ bun nodejs ];

  configurePhase = ''
    runHook preConfigure

    export HOME=$TMPDIR
    # Bring in the pre-fetched, read-only dependency tree.
    cp -R ${nodeModules}/node_modules ./node_modules
    chmod -R u+w node_modules

    # CLI tools (vite, svelte-kit, ...) ship `#!/usr/bin/env node` shebangs that
    # don't resolve in the build sandbox. The .bin entries are symlinks (which
    # patchShebangs skips), so patch the real files across the tree.
    patchShebangs node_modules

    runHook postConfigure
  '';

  buildPhase = ''
    runHook preBuild

    # Static, root-hosted build (base path stays empty). The committed BDK WASM
    # under src/lib/wasm/bdk is used as-is; run `bun run build:wasm` in the dev
    # shell to regenerate it from wallet-wasm.
    bun run build

    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    mkdir -p $out
    cp -R build/. $out/
    runHook postInstall
  '';

  meta = {
    description = "ContextBTC static site (SvelteKit, prebuilt)";
    homepage = "https://contextbtc.org";
    license = lib.licenses.lgpl3Only;
    platforms = lib.platforms.unix;
  };
}
