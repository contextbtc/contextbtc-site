{
  description = "ContextBTC Site — SvelteKit static site (Bun) + BDK WASM";

  # Include the hal-wasm submodule (and its nested hal submodule) in the source.
  # Must be written at top level: Nix ignores it when nested in `inputs = { … }`.
  inputs.self.submodules = true;

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, flake-utils, rust-overlay }:
    let
      perSystem = flake-utils.lib.eachDefaultSystem (system:
        let
          pkgs = import nixpkgs {
            inherit system;
            overlays = [ rust-overlay.overlays.default ];
          };

          rustToolchain = pkgs.rust-bin.stable.latest.default.override {
            targets = [ "wasm32-unknown-unknown" "wasm32-wasip1" ];
            extensions = [ "rust-src" ];
          };

          # Unwrapped clang/llvm to compile vendored C deps (secp256k1-sys, ring)
          # for wasm32. Nix's default CC is host gcc, which the `cc` crate would
          # otherwise use for every target, producing non-wasm object files.
          clang = pkgs.llvmPackages.clang-unwrapped;
          llvm = pkgs.llvmPackages.llvm;

          # hal CLI for WASI (hal.wasm + hal.js), built from the hal-wasm submodule.
          hal-wasm = pkgs.callPackage ./hal-wasm/nix/package.nix {
            rustPlatform = pkgs.makeRustPlatform {
              cargo = rustToolchain;
              rustc = rustToolchain;
            };
          };

          contextbtc-site = pkgs.callPackage ./nix/package.nix { halWasm = hal-wasm; };

          # OpenRouter free-model proxy for the chat's "Free" provider.
          free-proxy = pkgs.callPackage ./free-proxy/nix/package.nix { };
        in
        {
          packages = {
            default = contextbtc-site;
            inherit contextbtc-site hal-wasm free-proxy;
          };

          devShells.default = pkgs.mkShell {
            packages = with pkgs; [
              bun
              prettier
              rustToolchain
              wasm-pack
              wasm-bindgen-cli
              binaryen
              clang
              llvm
              lld
              pkg-config
              openssl
            ];

            # Force the `cc` crate to use clang targeting wasm for the wasm build,
            # overriding Nix's host CC. Only applies to the wasm32 target.
            CC_wasm32_unknown_unknown = "${clang}/bin/clang";
            AR_wasm32_unknown_unknown = "${llvm}/bin/llvm-ar";
            CFLAGS_wasm32_unknown_unknown = "--target=wasm32-unknown-unknown";
            # Same for hal-wasm's wasm32-wasip1 build (`bun run build:hal`).
            CC_wasm32_wasip1 = "${clang}/bin/clang";
            AR_wasm32_wasip1 = "${llvm}/bin/llvm-ar";
            inherit (hal-wasm) CFLAGS_wasm32_wasip1;

            shellHook = ''
              echo "ContextBTC Site dev shell"
              echo "  bun    $(bun --version)"
              echo "  rustc  $(rustc --version)"
              echo "  wasm-pack $(wasm-pack --version)"
              echo "Run 'bun install', 'bun run build:wasm', 'bun run build:hal' and 'bun run dev' to get started."
            '';
          };

          formatter = pkgs.nixpkgs-fmt;
        });
    in
    perSystem // {
      # System-independent overlay: exposes `pkgs.contextbtc-site` and `pkgs.contextbtc-free-proxy`.
      # The consumer's pkgs must provide `hal-wasm` (see packages.hal-wasm).
      overlays.default = final: prev: {
        contextbtc-site = final.callPackage ./nix/package.nix { halWasm = final.hal-wasm; };
        contextbtc-free-proxy = final.callPackage ./free-proxy/nix/package.nix { };
      };

      # NixOS service: `services.contextbtc-free-proxy` (see free-proxy/nix/module.nix).
      nixosModules.free-proxy = { pkgs, ... }: {
        imports = [ ./free-proxy/nix/module.nix ];
        services.contextbtc-free-proxy.package = nixpkgs.lib.mkDefault
          self.packages.${pkgs.stdenv.hostPlatform.system}.free-proxy;
      };
    };
}
