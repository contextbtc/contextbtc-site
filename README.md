# ContextBTC Site

Landing page and showcase for ContextBTC tools built on top of ContextVM. This site is heavily inspired from https://github.com/ContextVM/contextvm-site.

## Getting Started

```sh
bun install      # Install dependencies
bun run dev      # Start the dev server
bun run build    # Build for production (static)
bun run preview  # Preview the production build
bun run check    # Type-check the project
bun run lint     # Lint + format check
bun run format   # Format with Prettier
```

## Using it in your NixOS config

The flake exposes `packages.default`, which fetches the repo, runs `bun install`,
and `bun run build`, and evaluates to the directory of static files. Add the repo
as a flake input and point your own nginx at the built package:

```nix
{
  inputs.contextbtc-site.url = "github:karliatto/contextbtc-site";

  outputs = { self, nixpkgs, contextbtc-site, ... }: {
    nixosConfigurations.myhost = nixpkgs.lib.nixosSystem {
      system = "x86_64-linux";
      modules = [
        {
          services.nginx.enable = true;
          services.nginx.virtualHosts."contextbtc.example.org" = {
            # The built static site (fetch + bun install + bun run build).
            root = contextbtc-site.packages.x86_64-linux.default;
            # Needed only because the app uses `fallback: index.html`; this makes
            # client-side routes resolve on refresh.
            locations."/".tryFiles = "$uri $uri/ /index.html";
          };
        }
      ];
    };
  };
}
```

You can also build the static bundle standalone:

```sh
nix build github:karliatto/contextbtc-site#default
```

> **Note:** the `outputHash` in `nix/package.nix` (the `bun install` step) must be
> refreshed whenever `bun.lock` changes: set it to `lib.fakeHash`,
> run the build (nix build .#default), and paste back the hash Nix reports.
