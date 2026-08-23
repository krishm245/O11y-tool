# O11y Replay

A local-first browser session recorder under active development.

## How the prototype fits together

The repository has three runnable apps and two small shared packages:

- `apps/extension` records silent WebM video from the selected browser tab.
- `apps/local-api` stores Session metadata in SQLite and video on disk.
- `apps/web` lists, deletes, and plays durable Sessions.
- `packages/protocol` contains the HTTP types and runtime validation shared by
  the apps.
- `packages/session-clock` contains the persisted elapsed-time calculation used
  by the extension popup.

The recording flow is:

```text
extension popup -> background -> offscreen recorder -> local API -> local disk
web app ---------------------------------------------------------> local API
```

The recorder targets 720p at 15 frames per second, uploads five-second chunks,
and stops after 30 minutes. See [`milestone.md`](./milestone.md) for the delivery
sequence. `PLAN.md` is the longer-term design reference.

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

The local API binds only to `127.0.0.1`, so other devices cannot connect to it.
