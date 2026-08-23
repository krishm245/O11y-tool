# O11y Replay web app

The local React application for browsing and replaying captured sessions.

## Commands

- `pnpm dev` starts Vite at `http://127.0.0.1:5173`.
- `pnpm typecheck` checks the TypeScript project without emitting files.
- `pnpm test` runs the Session library client tests.
- `pnpm build` creates the production bundle in `dist/`.

The app loads saved sessions from `http://127.0.0.1:7331`. It shows each
session's lifecycle state and metadata, and it can delete local recordings.
