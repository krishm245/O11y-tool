# O11y Replay Local API

The localhost-only service that owns session metadata. Metadata is stored in a
SQLite database and survives service restarts. Recording artifacts are planned
work.

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

By default, the database is stored at `~/.o11y-replay/sessions.sqlite`. Set
`O11Y_DATA_DIR` before starting the service to use a different local data
directory.
