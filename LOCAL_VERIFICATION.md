# Local POC verification — 2026-10-13

Development branch: `codex/local-network-poc`, created before modifications at the existing `d40b464` checkpoint. No push, merge or deployment performed.

Verified on Windows / Node 22.13:

- 31 unit/UI/backend tests passed (25 existing tests preserved, 6 local tests added).
- 3 local Playwright scenarios passed: QR decoded from pixels; independent computer/phone contexts; bidirectional Unicode/text/links and images; original download bytes; picker/paste/drop; guest rotation/replay rejection; termination and feed cleanup; responsive mobile light/dark UI.
- Actual LAN IPv4 HTTP origin tested in Chromium with `isSecureContext=false`, no `crypto.subtle`, no Clipboard API and WebRTC disabled. Phone-side text/image transfer and manual-copy fallback passed.
- A full 10 MiB image transferred through the LAN origin; 10 MiB + 1 was rejected by the UI.
- All 7 original cloud integration/E2E tests passed unchanged, using the original local Worker/Durable Object runtime and WebRTC.
- Strict TypeScript, ESLint, local production build and cloud production build passed. Dependency installation reported zero known vulnerabilities.
- Windows `start-local.bat` successfully built and started the single server, selected Wi-Fi IPv4 `192.168.1.96`, printed both URLs and invoked default-browser opening. A second start correctly failed with the explicit port-occupied message.
- Host-disconnect grace cleanup and the original 24-hour expiry deadline are checked with an injected backend clock, not a physical 24-hour soak.

Original `apps/signaling`, `services/session.ts`, shared cloud protocol, cloud deployment configuration, `playwright.config.ts`, existing unit tests and existing `tests/e2e` remain intact. New Node backend and local frontend services are separate. Shared Transfer accepts optional transport/crypto/size configuration with original cloud defaults; App selects the execution mode. Package scripts, Vite outputs, CI, ignore rules, README, architecture/security introductions and Copy fallback were updated. Cloud runtime is inactive in the default mode and remains available through `*:cloud` scripts.

Still requires manual checks: physical iPhone Safari/Android Chrome, phone Camera scanning, Private firewall prompts and rules, router isolation, iOS save/share behavior, virtual keyboard and long-running/background sessions. Automated browsers simulate devices and do not certify physical phones. HTTP/WS remains intentionally unencrypted; trusted Wi-Fi only. Follow LOCAL_SETUP.md.
