# O11y Replay Web

The local React application for browsing and replaying captured sessions.

## Commands

- `pnpm dev` starts Vite at `http://127.0.0.1:5173`.
- `pnpm typecheck` checks the TypeScript project without emitting files.
- `pnpm build` creates the production bundle in `dist/`.

The app checks `http://127.0.0.1:7331/health` and renders checking, connected,
and unavailable states. The session list belongs to the next end-to-end
milestone.
