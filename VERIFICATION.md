# Verification record — 2026-10-11

Local verification used Windows, Node 22.13.0, npm, the pinned Wrangler runtime, and Playwright Chromium 156. Two isolated browser contexts simulated a desktop and a 390 × 844 phone viewport. This is not a physical-device or public-network certification.

| Check                 | Result                                                                                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Clean `npm ci`        | Passed; npm audit reported zero known vulnerabilities                                                                                         |
| `npm run lint`        | Passed against authored source; generated Wrangler/build/preview output is ignored                                                            |
| `npm run typecheck`   | Passed with strict TypeScript                                                                                                                 |
| `npm test`            | 25 tests passed across protocol, transfer, session lifecycle and safe UI rendering                                                            |
| `npm run build`       | Passed; frontend JS ~114 KB gzip, CSS ~4 KB gzip                                                                                              |
| `npm run test:e2e`    | 7 scenarios passed using real local Durable Objects and WebRTC                                                                                |
| Worker deploy dry-run | Packaging/bindings verified; no production deployment                                                                                         |
| GitHub Actions        | [Validate run](https://github.com/RecepU/FromComputerToPhone/actions/runs/38124862099) succeeded for commit `76f8bf2`, including all CI steps |
| Visual QA             | Desktop pairing/workspace, mobile light/dark; no mobile horizontal overflow                                                                   |

The integration/E2E scenarios exercised separate host/guest authorization, third-device rejection, signaling forwarding, credential rotation and replay rejection, malformed messages, HTTP payload/origin checks, authenticated ICE configuration, host reconnect/grace termination, server-enforced expiry while heartbeats continue, QR decoding/hiding, bidirectional Unicode/text/links, clipboard copying, multi-chunk images, exact downloaded file bytes, picker/paste/drop input paths, guest replacement and terminal feed cleanup. No browser `pageerror` occurred in the main sharing scenario.

Expiration was tested with a three-second configured backend lifetime, through the same alarm/deadline path used by the 24-hour production setting. Unit tests verify the lifetime clamp; a real 24-hour soak was not run. Expected Vite development proxy abort diagnostics can appear when tests close contexts/invalid room handshakes; these did not fail the tests or indicate uncaught application exceptions.

## Remaining verification

- Cloudflare account-specific deployment, binding provisioning, production HTTPS/WSS, domain/CORS/CSP configuration and actual free-plan quota usage.
- Physical Windows Chrome/Edge, iPhone Safari and Android Chrome, including real OS screenshot paste, downloads/clipboard behavior, virtual keyboards, background suspension and accessibility with assistive technology.
- Wi-Fi ↔ cellular and restrictive networks. TURN HMAC credential generation is unit-tested, but no live relay or forced-relay transfer was provisioned/tested.
- Long-session endurance, actual 24-hour duration and public load/abuse testing.

Follow [MANUAL_TESTS.md](MANUAL_TESTS.md) and [DEPLOYMENT.md](DEPLOYMENT.md) before declaring all production acceptance criteria verified. Local QA screenshots, build output and runtime state are ignored by Git.
