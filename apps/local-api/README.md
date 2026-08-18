# O11y Replay Local API

The localhost-only service that will own session metadata and recording
artifacts.

## Commands

- `pnpm dev` starts the service with file watching.
- `pnpm start` starts the service once.
- `pnpm test` runs the Fastify injection tests.
- `pnpm typecheck` checks TypeScript without emitting files.

The service listens on `http://127.0.0.1:7331`. Its current public surface is
`GET /health`; session routes are intentionally deferred to the next milestone.
During development, browser access is limited to the web app served from port
5173 on either `127.0.0.1` or `localhost`.
