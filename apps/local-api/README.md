# O11y Replay Local API

The localhost-only service that owns session metadata. Metadata is currently
kept in memory and is lost when the process stops; durable storage and recording
artifacts are planned work.

## Commands

- `pnpm dev` starts the service with file watching.
- `pnpm start` starts the service once.
- `pnpm test` runs the Fastify injection tests.
- `pnpm typecheck` checks TypeScript without emitting files.

The service listens on `http://127.0.0.1:7331`. Its current routes are:

- `GET /health`
- `POST /v1/sessions`
- `GET /v1/sessions`

During development, browser access is limited to the web app served from port
5173 on either `127.0.0.1` or `localhost`.
