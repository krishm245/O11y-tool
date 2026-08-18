# O11y Replay

A local-first browser session recorder under active development.

## Prerequisites

- Node.js 22+
- pnpm 10.18.0

## Workspace commands

- `pnpm install` installs every workspace package.
- `pnpm dev` starts the extension, web app, and local API in parallel.
- `pnpm typecheck` checks all TypeScript packages.
- `pnpm test` runs all available tests.
- `pnpm build` builds or validates all packages.

## Local development endpoints

- Web app: `http://127.0.0.1:5173`
- Local API: `http://127.0.0.1:7331`
- Health check: `http://127.0.0.1:7331/health`

The local API deliberately binds to `127.0.0.1`, not all network interfaces.
