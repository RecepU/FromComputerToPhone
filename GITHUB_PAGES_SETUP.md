# GitHub Pages + preserved cloud mode

Published frontend target: https://recepu.github.io/FromComputerToPhone/

Backend: https://from-computer-to-phone-signaling.from-computer-to-phone.workers.dev

GitHub Pages serves only the static cloud frontend; the existing Cloudflare Worker and SQLite Durable Objects provide WebSocket signaling. Transfers remain encrypted WebRTC peer-to-peer. Local HTTP/WS POC remains independent and default for Windows startup; it is not publicly exposed.

## Publish

Pages settings: Settings → Pages → Source: GitHub Actions. Workflow `.github/workflows/pages.yml` builds `cloud` mode at `/FromComputerToPhone/`. Repository variable `VITE_API_URL` contains the public backend URL above (not a secret). Publishing currently runs on pushes to `codex/local-network-poc` and `main`, or workflow_dispatch. The feature branch is published without merging it into main; when the work is reviewed, publishing can be limited to main.

The build copies index.html to 404.html for guest deep links, uses absolute repository-prefixed asset/QR paths, and creates .nojekyll. GitHub Pages returns HTTP 404 for a guest deep link while rendering the custom application document; successful application pairing is verified separately.

Backend redeployment keeps the original local-development Worker configuration intact and supplies the production origin override explicitly:

```powershell
npx.cmd wrangler login
npx.cmd wrangler deploy --config apps/signaling/wrangler.jsonc --var ALLOWED_ORIGINS:https://recepu.github.io
```

Do not redeploy with the local-origin defaults for production. No TURN relay or paid plan is provisioned. Some networks still require optional TURN; follow DEPLOYMENT.md if needed. Workers Free SQLite DO quotas apply and quota exhaustion can fail operations.

## Verify the live site

```powershell
$env:LIVE_CLOUD_URL = 'https://recepu.github.io/FromComputerToPhone/'
node tests/live/cloud.mjs
```

This opt-in test creates a real live room using two isolated Chromium contexts, checks QR deep links, real signaling/WebRTC, bidirectional text/images, exact download bytes, layout, end and replay rejection. It requires the Playwright Chromium installation. Physical-phone and cross-network checks remain manual.

## Hosting security limits

GitHub Pages does not honor Cloudflare `_headers`. The build injects an applicable CSP meta tag and a no-referrer meta tag; response-only protections such as frame-ancestors, X-Frame-Options and Cache-Control cannot be set by this static workflow. Static application assets may be cached by the platform. Shared content still lives in memory only with no service worker/offline content storage. GitHub records visitor IPs and may observe room paths; guest secrets remain URL fragments and are removed after parsing. Worker origin allowlisting necessarily trusts the whole recepu.github.io origin, including other projects hosted on that origin.

Official documentation: [GitHub Pages overview](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages), [custom workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages), [SQLite DO pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/).
