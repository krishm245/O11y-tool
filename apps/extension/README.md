# O11y Replay Chrome extension

The Manifest V3 extension starts and stops metadata-only O11y Replay Sessions
for the active HTTP or HTTPS tab. Session metadata is sent to the local API at
`http://127.0.0.1:7331` and recording state is retained in extension storage.

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

## Checks

```sh
pnpm --filter @app-o11y/extension test
pnpm --filter @app-o11y/extension typecheck
```
