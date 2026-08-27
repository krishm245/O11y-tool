# Local-first browser session recorder

## Summary

Build a Chrome Manifest V3 extension, a React/Vite web app, and a local API that records one explicitly selected website origin.

Each session contains:

- Silent 720p/15fps tab video.
- DOM snapshots and mutations for inspectable replay.
- Timestamped clicks, inputs, scrolling, navigation, and application network metadata.
- Paused intervals when the tab leaves the starting origin.
- Synchronized video/DOM playback with an interaction and network timeline.

Recordings remain local and expire after 30 days. Cloud storage, authentication, and team workspaces are deferred, while shared protocols remain cloud-compatible.

## Architecture and implementation

- Create a pnpm TypeScript workspace:
  - `apps/extension`: WXT, React, and Manifest V3.
  - `apps/web`: React, Vite, React Router, and TanStack Query.
  - `apps/local-api`: Fastify, SQLite, and filesystem artifact storage.
  - Shared packages for schemas, privacy, clock synchronization, and API clients.
- Add root scripts for `dev`, `build`, `typecheck`, `test`, and `test:watch`.
- Use Chrome 116+ with `tabCapture` and an offscreen document for recording across navigation.
- Request `activeTab`, `scripting`, `tabCapture`, `offscreen`, `storage`, and `webNavigation`. The toolbar click grants temporary `activeTab` access to the selected origin without a separate site-access prompt.
- Coordinate sessions through the extension service worker:
  - Verify and pair with the local API.
  - Establish a shared monotonic session clock.
  - Inject the page recorder.
  - Start the offscreen `MediaRecorder`.
  - Coordinate navigation, uploads, limits, recovery, and finalization.
- Record silent WebM at a 1.5 Mbps target. Prefer VP9 and fall back to VP8.
  Emit five-second chunks and stop at 30 minutes or 500 MB.
- Use `@rrweb/record` for DOM capture and `@rrweb/replay` for playback, including periodic full snapshots for seeking.
- Capture normalized clicks, input changes, scrolling, focus, and viewport changes.
  Also capture SPA navigation, pause and resume, and lifecycle events.
- Instrument page-world `fetch` and `XMLHttpRequest`, supplemented by `PerformanceObserver`.
  - Retain method, sanitized origin/path, query-key names, status, duration, resource type, and observable size.
  - Never retain bodies, headers, cookies, authorization values, or query values.
- Mask passwords, payment fields, token-like fields, and `.o11y-mask` content. Replace `.o11y-block` subtrees with placeholders and never retain raw keystrokes.
- When the tab leaves its starting origin:
  - Pause video, DOM, interaction, and network capture.
  - Add a paused-interval marker without retaining off-origin content.
  - Resume and reinject idempotently when the tab returns.
  - Exclude paused time from the playback clock while retaining its wall-clock duration.
- Store pending video and event chunks in extension IndexedDB until the local API
  acknowledges them. Use the session, artifact type, sequence, and checksum as
  the idempotency key.
- Stop gracefully and mark a session incomplete if queued data exceeds 256 MB.
- Pair the website and extension through `externally_connectable`, using a random local bearer token.
- Bind the API exclusively to `127.0.0.1`, with strict CORS and extension-origin checks.
- Store metadata in SQLite, ordered WebM/event chunks on disk, and gzip-compressed event batches. Assemble the final video after recording.
- Run retention cleanup at service startup and daily.

## Interfaces and web experience

Define versioned shared types for:

- `SessionManifest`: identity, schema version, origin, title, viewport, timestamps, active duration, state, privacy version, codec, sizes, and optional future `workspaceId`.
- `TimelineEvent`: ID, active-time offset, wall time, category, sanitized summary, and typed metadata.
- `ArtifactChunk`: session, kind, sequence, active-time range, length, checksum, and payload.
- `PausedInterval`: reason, wall-clock range, and active-time insertion point.
- Session states: `creating`, `recording`, `paused`, `processing`, `ready`, `incomplete`, and `failed`.

Expose the local API:

- `POST /v1/sessions`
- `PUT /v1/sessions/:id/chunks/:kind/:sequence`
- `POST /v1/sessions/:id/pause`
- `POST /v1/sessions/:id/resume`
- `POST /v1/sessions/:id/finalize`
- `GET /v1/sessions`
- `GET /v1/sessions/:id`
- `GET /v1/sessions/:id/video` with range support
- `GET /v1/sessions/:id/events`
- `DELETE /v1/sessions/:id`

Build the Vite web app as a client-rendered SPA with:

- A recording library showing title, origin, date, duration, size, readiness, and deletion controls.
- A player with a shared playhead controlling Video and DOM Replay views.
- A side timeline filterable by interactions, navigation, network, errors, and pauses.
- Event selection that seeks both replay modes to the matching timestamp.
- Sanitized network-detail panels.
- Clear loading, empty, unavailable-service, incomplete-session, and corrupt-artifact states.

## Test plan

- Configure Vitest projects for shared packages, the web app, extension logic, and local API.
- Use Testing Library with Vitest and jsdom for React components, routes, timeline filtering, synchronized seeking, error states, and accessibility behavior.
- Use Vitest for clock conversion, pause accounting, event ordering, redaction, URL sanitization, checksums, retries, limits, and retention.
- Test Fastify routes through request injection for idempotency, out-of-order chunks, authorization, interrupted finalization, range requests, corruption, deletion, and restart recovery.
- Use fake timers to test the 30-minute limit and 30-day expiry.
- Keep Playwright as a separate browser-level suite because Vitest cannot test
  real Chrome extension APIs.
  - Test recording, typing, scrolling, SPA navigation, and `fetch` or
    `XMLHttpRequest` calls.
  - Test reloads, cross-origin pause and resume, tab closure, and service
    interruption.
- Verify sensitive values never appear in events, DOM snapshots, logs, or summaries.
- Verify off-origin content is absent from video and event artifacts.
- Keep video, DOM replay, and timeline events within 250 ms of the shared playhead.

## Assumptions and delivery

- The first milestone is an unpacked, developer-run local prototype without accounts, billing, public links, microphone capture, bodies, headers, or Chrome debugger traffic.
- Cross-origin iframe content appears in video but does not expose DOM events.
- Restricted pages such as `chrome://` and the Chrome Web Store cannot be recorded.
- Team workspaces and workspace-only access belong to the later cloud milestone.
- Cloud migration will replace SQLite/filesystem adapters with Postgres, object storage, signed uploads, background processing, and workspace authorization without changing capture schemas.
- Chrome Web Store distribution requires explicit recording consent, a persistent recording indicator, privacy disclosures, secure handling, and minimum permissions.
