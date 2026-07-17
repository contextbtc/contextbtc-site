{
  description = "ContextBTC Site — SvelteKit static site (Bun) + BDK WASM";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { self, nixpkgs, flake-utils, rust-overlay }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
          overlays = [ rust-overlay.overlays.default ];
        };

        rustToolchain = pkgs.rust-bin.stable.latest.default.override {
          targets = [ "wasm32-unknown-unknown" ];
          extensions = [ "rust-src" ];
        };

        # Unwrapped clang/llvm to compile vendored C deps (secp256k1-sys, ring)
        # for wasm32. Nix's default CC is host gcc, which the `cc` crate would
        # otherwise use for every target, producing non-wasm object files.
        clang = pkgs.llvmPackages.clang-unwrapped;
        llvm = pkgs.llvmPackages.llvm;
      in
      {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            bun
            nodePackages.prettier
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

          shellHook = ''
            echo "ContextBTC Site dev shell"
            echo "  bun    $(bun --version)"
            echo "  rustc  $(rustc --version)"
            echo "  wasm-pack $(wasm-pack --version)"
            echo "Run 'bun install' then 'bun run build:wasm' and 'bun run dev' to get started."
          '';
        };

        formatter = pkgs.nixpkgs-fmt;
      });
}
