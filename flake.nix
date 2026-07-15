{
  description = "ContextBTC Site — SvelteKit static site (Bun)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs { inherit system; };
      in
      {
        devShells.default = pkgs.mkShell {
          packages = with pkgs; [
            bun
          ];

          shellHook = ''
            echo "ContextBTC Site dev shell"
            echo "  bun $(bun --version)"
            echo "Run 'bun install' then 'bun run dev' to get started."
          '';
        };

        formatter = pkgs.nixpkgs-fmt;
      });
}
