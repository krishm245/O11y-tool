# O11y Replay Web

The local React application for browsing and replaying captured sessions.

## Commands

- `pnpm dev` starts Vite at `http://127.0.0.1:5173`.
- `pnpm typecheck` checks the TypeScript project without emitting files.
- `pnpm test` runs the Session library client tests.
- `pnpm build` creates the production bundle in `dist/`.

The app loads durable Sessions from `http://127.0.0.1:7331`, renders their
lifecycle state and metadata, and lets the user delete recordings locally.
