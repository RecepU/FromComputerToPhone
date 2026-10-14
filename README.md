# FromComputerToPhone

**Default mode is now the same-Wi-Fi LOCAL POC.** Double-click `start-local.bat`, or run `npm ci` then `npm run dev`; open `http://localhost:3000`. See [LOCAL_SETUP.md](LOCAL_SETUP.md) for LAN IP override, phone connection, Private firewall rules and browser limits.

The original cloud implementation below is preserved as optional `cloud` mode: `npm run dev:cloud`, `npm run build:cloud`, `npm run test:e2e:cloud`. Its source, dependencies, deployment configuration and tests remain intact. Local mode uses unencrypted HTTP/WS on trusted private Wi-Fi only.

Open on your computer → scan with your phone → share → end the session.

A React/TypeScript application with Cloudflare Workers + SQLite-backed Durable Objects for capability-authorized WebSocket signaling. Text and original images travel over an encrypted, ordered WebRTC data channel. No accounts, analytics, transfer database or uploaded image storage.

## Original cloud mode: local development

Requires Node 22.13+ and npm. The checked-in lockfile pins compatible dependencies; TypeScript 5.9 is used within typescript-eslint's supported range.

```sh
npm ci
npm run dev:cloud
```

Open `http://localhost:5173`. Vite proxies `/api` to Wrangler on port 8787. Two desktop browser contexts work locally. **A physical phone needs a publicly reachable HTTPS frontend and WSS backend**; a localhost QR points to the phone itself. See [DEPLOYMENT.md](DEPLOYMENT.md). Plain LAN HTTP cannot provide the required secure browser APIs.

```sh
npm run lint
npm run typecheck
npm test
npm run build:cloud
npx playwright install chromium
npm run test:e2e:cloud
```

E2E starts the real Wrangler runtime, a short-lived expiry runtime on port 8788, and Vite. Keep 5173, 8787 and 8788 free. It uses independent browser contexts and decodes the QR image. Backend integration tests are included in `test:e2e`. Failure traces, videos and automatic failure screenshots are disabled. Explicit visual QA PNGs are saved under ignored `.local-preview/`; their QR becomes unusable when the test room ends/runtime shuts down. Treat any screenshots of live credentials or private content as sensitive.

## Features and limits

- A fresh 256-bit room identifier, independent host capability and ten-minute guest pairing capability.
- One host and one guest. Host credentials are never included in the QR; the guest credential is removed from the address bar after parsing.
- Bidirectional text, Unicode, line breaks, HTTP/HTTPS links and explicit clipboard copying. Maximum 64 KB of UTF-8 text; JSON overhead can reduce the single-message limit. Longer content shows an error instead of silently truncating.
- PNG, JPEG, WebP and GIF, up to 10 MiB. File picker, desktop paste and drag/drop. 16 KiB binary chunks, sequence validation, backpressure, SHA-256 integrity, acknowledgment, progress, cancellation, preview and download.
- In-memory feed limited to 40 items / 60 MiB of image data per browser. Old previews are revoked when evicted. Received and sent text appear after receipt/confirmation. No session history restoration.
- Light/dark theme, keyboard controls, labeled inputs, live statuses, semantic feed, native confirmation dialog, reduced-motion styles and responsive layouts.
- Guest departure preserves the room, rotates its pairing capability, and exposes a fresh QR on the computer. Rejoin by scanning this new QR; the old guest URL is deliberately invalidated.
- Manual host termination clears both peers. Tab departure attempts `fetch(..., keepalive)`; backend WebSocket and heartbeat detection provide cleanup if the browser sends nothing.
- Maximum server lifetime is 24 hours from creation, never extended by activity. Explicit socket disconnection gives the host a 15-second grace period. A silent network loss takes up to roughly 45–75 seconds for heartbeat detection plus grace/alarms. OS/browser suspension can cause a legitimate session to end.
- Transferred content is never persisted by the application. **Explicit downloads and copies are user-created local copies and cannot be erased by the website.**

TURN is optional. Some NATs/firewalls cannot connect without it. There is no guaranteed universal, free cross-network connection. Configured coturn-compatible TURN REST secrets stay in the Worker; authenticated clients receive one-hour credentials, refreshed before every new negotiation/Retry Connection. Relay allocation behavior is provider-dependent.

Production deployment and physical Windows/iPhone/Android cross-network tests require external accounts/devices and are not implied by automated Chromium tests. No deployment is performed by installing or building this repository.

The image limit is centralized in `packages/shared/protocol.ts` (`MAX_FILE_SIZE`); UI labels and validation use that value. Rebuild the frontend when changing it and keep paired devices on the same protocol/build. Filename sanitization may add a safe image extension; image bytes are never compressed or modified.

## Layout

```text
apps/web/src/{components,pages,services,styles}
apps/web/public/_headers
apps/signaling/src/{worker,room,security,types}.ts
apps/signaling/wrangler.jsonc
packages/shared/protocol.ts
tests/unit/                   # validation, hashing, transfer, safe rendering
tests/e2e/                    # real backend integration and two-device WebRTC
.github/workflows/ci.yml
```

Read [ARCHITECTURE.md](ARCHITECTURE.md), [SECURITY.md](SECURITY.md), [DEPLOYMENT.md](DEPLOYMENT.md), [VERIFICATION.md](VERIFICATION.md), and [MANUAL_TESTS.md](MANUAL_TESTS.md).
