# O11y Replay milestones

## Goal

Deliver a local-first prototype that a tester can run on their own computer in
regular Google Chrome. The tester must be able to start the local services,
load the extension as an unpacked Manifest V3 extension, record a supported
HTTP/HTTPS tab, stop the recording, and replay the resulting session in the web
app.

This checklist covers the local prototype only. Chrome Web Store publication,
cloud hosting, accounts, billing, team workspaces, and public sharing are later
delivery tracks.

## How we use this file

- Complete the milestones in order unless a task is explicitly independent.
- Tick a task only when its implementation and relevant tests are complete.
- Tick a milestone's acceptance gate only after manually verifying its full
  user-visible workflow.
- Add a short note or link next to a checkbox when a decision changes its scope.

## Milestone 0: stabilize the current foundation

Current snapshot: 18 August 2026.

- [x] Create the pnpm workspace for the extension, web app, local API, and
      shared packages.
- [x] Add root `dev`, `build`, `typecheck`, and `test` commands.
- [x] Define and validate the first version of the shared Session protocol.
- [x] Implement the shared elapsed-time clock used by the extension popup.
- [x] Bind the API to `127.0.0.1` and expose a health check.
- [x] Implement in-memory create/list Session endpoints.
- [x] Build the web app's local-service connected/unavailable states.
- [x] Build the extension popup's start/stop controls, persisted coordinator
      state, timer, and recording badge.
- [x] Have the extension create a Session through the local API.
- [x] Produce a Chrome Manifest V3 build with WXT.
- [x] Pass the current automated test suite (25 tests at this snapshot).
- [x] Fix the strict TypeScript error in `packages/session-clock` so the root
      `pnpm typecheck` command passes.
- [x] Replace remaining WXT starter package metadata and README content with
      O11y Replay-specific names and instructions.
- [x] Confirm `pnpm install`, `pnpm test`, `pnpm typecheck`, and `pnpm build`
      all succeed from a fresh checkout.

Acceptance gate:

- [ ] A developer can start all three apps, load the generated unpacked
      extension in Chrome, create/stop a metadata-only Session, and see no console
      or service-worker errors.

## Milestone 1: durable session lifecycle and library

Make Session metadata survive restarts and make the three apps agree on the
complete recording lifecycle before adding large capture artifacts.

### Shared protocol

- [x] Expand `SessionManifest` with recording/processing timestamps, active
  duration, viewport, codec, artifact sizes, failure information, and privacy
  version.
- [x] Finalize lifecycle states: `creating`, `recording`, `paused`,
  `processing`, `ready`, `incomplete`, and `failed`.
- [x] Define versioned request/response contracts for get, pause, resume,
  finalize, and delete operations.
- [x] Add protocol validation and compatibility tests for every contract.

### Local API

- [x] Add SQLite storage for Session metadata.
- [x] Add configurable local data directories for the database and artifacts.
- [x] Implement `GET /v1/sessions/:id`.
- [x] Implement pause, resume, finalize, and delete endpoints.
- [x] Make lifecycle transitions validated and idempotent.
- [x] Recover persisted Sessions after an API restart.

### Extension and web app

- [x] Have extension stop/tab-close flows finalize or mark the Session
      incomplete instead of only clearing extension state.
- [x] Recover the extension's active Session after its service worker restarts.
- [x] Fetch and render real Sessions in the web recording library.
- [x] Show title, origin, date, duration, state, and delete controls.
- [x] Add loading, empty, API-unavailable, incomplete, and failed states.

Acceptance gate:

- [ ] A metadata-only Session created in Chrome remains visible after restarting
      Chrome, the web app, and the local API, and can be deleted from the library.

## Milestone 2: record and store tab video

Produce the first end-to-end playable artifact from a real Chrome tab.

### Extension capture

- [ ] Add only the required Chrome permissions: `tabCapture`, `offscreen`,
      `scripting`, `webNavigation`, `storage`, and temporary access to the selected
      origin.
- [ ] Create an offscreen document that owns `MediaRecorder` across navigation
      and popup closure.
- [ ] Capture silent tab video at the target 720p/15fps settings.
- [ ] Prefer WebM/VP9 and fall back to WebM/VP8 after checking browser support.
- [ ] Split video into ordered chunks (target: five seconds each).
- [ ] Keep the toolbar badge and popup state accurate while recording.
- [ ] Stop cleanly on user action, owned-tab closure, capture failure, or the
      30-minute limit.

### Upload and storage

- [ ] Define the versioned `ArtifactChunk` contract with kind, sequence,
      active-time range, byte length, and checksum.
- [ ] Implement idempotent chunk upload endpoints.
- [ ] Validate sequence metadata, sizes, and checksums at the API boundary.
- [ ] Store chunks in a per-Session artifact directory.
- [ ] Assemble or expose a seekable final WebM when recording finishes.
- [ ] Implement `GET /v1/sessions/:id/video` with HTTP range support.
- [ ] Track artifact size and processing/failure state in the Session manifest.

### Minimal playback

- [ ] Add a Session details route to the web app.
- [ ] Play the completed video with standard seek/play/pause controls.
- [ ] Show useful processing, missing-video, and corrupt-video states.

Acceptance gate:

- [ ] A tester can record a two-minute tab session in Chrome, stop it, open it
      from the library, seek through the video, and replay it after restarting all
      local services.

## Milestone 3: capture inspectable events safely

Add DOM replay and a useful debugging timeline without collecting secrets.

### Privacy rules first

- [ ] Create a shared privacy/sanitization package with a versioned policy.
- [ ] Mask passwords, payment fields, token-like fields, and `.o11y-mask`
      content before data leaves the page.
- [ ] Replace `.o11y-block` subtrees with placeholders.
- [ ] Never store raw keystrokes, request/response bodies, headers, cookies,
      authorization values, or URL query values.
- [ ] Add adversarial tests proving sensitive fixtures do not appear in events,
      snapshots, API logs, or stored artifacts.

### Page recorder

- [ ] Inject an idempotent content/page recorder only into the selected origin.
- [ ] Integrate rrweb recording for initial DOM snapshots and mutations.
- [ ] Capture timestamped clicks, sanitized input changes, scroll, focus,
      viewport changes, and page lifecycle events.
- [ ] Capture full and SPA navigation events.
- [ ] Instrument page-world `fetch` and `XMLHttpRequest` metadata.
- [ ] Supplement network timing with `PerformanceObserver` where useful.
- [ ] Normalize network records to method, sanitized origin/path, query-key
      names, status, duration, resource type, and observable size.
- [ ] Batch, gzip, sequence, checksum, and upload event chunks.
- [ ] Implement `GET /v1/sessions/:id/events` with deterministic ordering.

Acceptance gate:

- [ ] A test session shows DOM changes, interactions, navigation, and sanitized
      network activity on a shared active-time clock, while automated privacy
      fixtures confirm that sensitive values were not retained.

## Milestone 4: origin boundaries, buffering, and recovery

Make the recorder safe and resilient during realistic browsing and local
service interruptions.

### Origin control

- [ ] Detect full-page and SPA navigation away from the starting origin.
- [ ] Pause video, DOM, interaction, and network capture before retaining
      off-origin content.
- [ ] Record only a paused-interval marker and wall-clock duration while away.
- [ ] Reinject idempotently and resume when the tab returns to the starting
      origin.
- [ ] Verify off-origin content is absent from both video and event artifacts.

### Delivery resilience

- [ ] Queue pending video and event chunks in extension IndexedDB until the API
      acknowledges them.
- [ ] Use Session, artifact kind, sequence, and checksum as the idempotency key.
- [ ] Retry transient failures with bounded exponential backoff.
- [ ] Resume pending uploads after extension service-worker or Chrome restart.
- [ ] Handle out-of-order and duplicate chunks without corrupting a Session.
- [ ] Stop gracefully and mark the Session incomplete if the queue exceeds
      256 MB or storage becomes unavailable.
- [ ] Enforce the 500 MB per-Session hard limit.
- [ ] Detect interrupted finalization and recover or mark it incomplete on API
      restart.

Acceptance gate:

- [ ] A recording survives popup closure, service-worker suspension, API
      interruption, reloads, and a leave/return navigation. It retains no
      off-origin content and produces a valid replay.

## Milestone 5: complete synchronized replay experience

Turn captured artifacts into a practical debugging tool.

- [ ] Integrate rrweb replay as a DOM Replay view.
- [ ] Build one shared playhead for video, DOM replay, and timeline events.
- [ ] Add periodic full snapshots or checkpoints for dependable seeking.
- [ ] Build a side timeline for interactions, navigation, network, errors, and
      pauses.
- [ ] Add timeline filters and sanitized event detail panels.
- [ ] Seek both video and DOM replay when a timeline event is selected.
- [ ] Visually represent paused intervals and distinguish active time from wall
      time.
- [ ] Keep video, DOM replay, and events within 250 ms of the shared playhead.
- [ ] Handle incomplete or partially corrupt Sessions without crashing.
- [ ] Add keyboard navigation, focus states, labels, and basic accessibility
      checks for the library and player.

Acceptance gate:

- [ ] A tester can diagnose a sample failed workflow using the recording,
      inspectable DOM, event timeline, and sanitized network details in one player.

## Milestone 6: security, retention, and browser-level verification

Harden the local boundary and prove the workflow in real Chrome.

### Local security and retention

- [ ] Pair the extension and local API with a randomly generated local bearer
      token.
- [ ] Restrict API CORS to the supported local web origins and validate the
      expected extension origin for extension-only routes.
- [ ] Add `externally_connectable` only if the final pairing flow requires it.
- [ ] Reject unauthenticated artifact and lifecycle requests.
- [ ] Keep logs free of captured values and bearer tokens.
- [ ] Delete expired Sessions and all artifacts at startup and daily (default:
      30 days).
- [ ] Make deletion complete, failure-safe, and testable.

### Automated verification

- [ ] Add web component/route tests for the library, player, seeking, filters,
      errors, and accessibility behavior.
- [ ] Add API tests for authorization, idempotency, out-of-order chunks, range
      requests, corruption, deletion, retention, and restart recovery.
- [ ] Add extension unit tests for permissions, limits, retries, recovery, and
      navigation pause/resume.
- [ ] Add a separate Playwright/real-Chrome extension suite.
- [ ] Cover recording, typing, scrolling, SPA navigation, fetch/XHR, reloads,
      cross-origin pause/resume, tab closure, and API interruption.
- [ ] Run privacy regression fixtures as a required test gate.
- [ ] Confirm no critical errors or unhandled promise rejections in the web app,
      extension pages, service worker, or API during the end-to-end suite.

Acceptance gate:

- [ ] The full automated suite is green, followed by a successful clean-profile
      smoke test in the minimum supported regular Chrome version (Chrome 116+).

## Milestone 7: local tester release

Package the prototype so someone who did not build it can use it locally.

- [ ] Decide and document the supported OS and Node/pnpm versions for the first
      tester cohort.
- [ ] Provide one clear command for installing dependencies and one for running
      the local API plus web app.
- [ ] Produce a versioned Chrome extension build/zip from a clean checkout.
- [ ] Document how to open `chrome://extensions`, enable Developer mode, and
      load the unpacked `apps/extension/.output/chrome-mv3` directory.
- [ ] Document where local recordings are stored, the 30-day retention policy,
      how to delete them, and how to reset local data safely.
- [ ] Document supported pages and limitations (`http`/`https` only, no
      `chrome://` pages or Chrome Web Store, no microphone, and limited
      cross-origin iframe inspection).
- [ ] Add visible consent copy and a persistent recording indicator.
- [ ] Add troubleshooting steps for an unavailable API, denied permissions,
      unsupported pages/codecs, a stale extension build, and incomplete Sessions.
- [ ] Add a short tester feedback/bug-report template that includes versions and
      reproduction steps but excludes captured private data.
- [ ] Run the complete setup guide on a clean Chrome profile and a clean machine
      or VM.
- [ ] Tag the first local tester release and attach its exact extension artifact
      and setup instructions.

Final acceptance gate:

- [ ] A new tester can follow the README without developer assistance, install
      the local prototype in regular Chrome, record a supported website, replay and
      inspect the Session, restart the stack without losing it, and delete it.

## Deferred until after the local prototype

- [ ] Chrome Web Store submission and review.
- [ ] Signed/automatic desktop installer and background service management.
- [ ] Cloud API, Postgres, object storage, and background processing.
- [ ] Authentication, accounts, workspaces, authorization, and billing.
- [ ] Shared/public recording links and collaboration features.
- [ ] Firefox or other browser support.
