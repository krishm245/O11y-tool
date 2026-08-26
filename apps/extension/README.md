# O11y Replay Chrome extension

The Manifest V3 extension records silent WebM video and sanitized page events
from the selected HTTP or HTTPS tab. An offscreen document keeps video capture
alive when the popup closes or the tab navigates. An origin-scoped page recorder
captures interactions, navigation, and network metadata. The
extension uploads both artifact types to the local API at
`http://127.0.0.1:7331` and keeps coordinator state in extension storage.

## Develop

From the repository root, install dependencies and start the local API, web
app, and extension development server:

```sh
pnpm install
pnpm dev
```

To run only the extension development server:

```sh
pnpm --filter @app-o11y/extension dev
```

## Build and load in Chrome

Build the extension from the repository root:

```sh
pnpm --filter @app-o11y/extension build
```

Then open `chrome://extensions`, enable **Developer mode**, choose **Load
unpacked**, and select `apps/extension/.output/chrome-mv3`.

Keep the local API running while using the popup:

```sh
pnpm --filter @app-o11y/local-api dev
```

The popup supports regular `http://` and `https://` pages. Chrome internal
pages and the Chrome Web Store cannot be recorded.

Capture prefers VP9 and falls back to VP8. It targets 1280×720 at 15 frames per
second and stops automatically after 30 minutes.

The page recorder masks every form value, masks `.o11y-mask` content, and blocks
`.o11y-block` subtrees. Network events contain no bodies, headers, cookies,
authorization values, or URL query values.

## Checks

```sh
pnpm --filter @app-o11y/extension test
pnpm --filter @app-o11y/extension typecheck
```
