# O11y Replay

A local-first browser session recorder under active development.

## How the prototype fits together

The repository has three runnable apps and two small shared packages:

- `apps/extension` starts a metadata-only session for the active browser tab.
- `apps/local-api` validates and stores those sessions in SQLite.
- `apps/web` lists and deletes durable Sessions from the local API.
- `packages/protocol` contains the HTTP types and runtime validation shared by
  the apps.
- `packages/session-clock` contains the persisted elapsed-time calculation used
  by the extension popup.

The current request flow is intentionally short:

```text
extension popup -> extension background -> local API -> SQLite Session store
web app ---------------------------------> local API Session library
```

Video capture and replay are not implemented yet. See
[`milestone.md`](./milestone.md) for the delivery sequence; `PLAN.md` is the
longer-term design reference, not a description of the current implementation.

## Prerequisites

- Node.js 22.5+
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
