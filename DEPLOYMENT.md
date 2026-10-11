# Deploy to Cloudflare

No production deployment has been performed by this repository. A Cloudflare account, its actual permissions and a chosen frontend hostname are required. Stay on Workers Free unless you explicitly choose otherwise. TURN is optional and is a separate service; no paid relay is automatically provisioned.

## Verified platform assumptions

Official documentation checked on 2026-10-11:

- [Durable Objects pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/): Workers Free supports SQLite-backed Durable Objects. Free DO compute includes 100,000 requests/day and 13,000 GB-s/day. SQLite free storage includes 5 million row reads/day, 100,000 writes/day and 5 GB total. Free quota exhaustion fails operations; do not promise uninterrupted zero-cost service. Worker request limits apply separately.
- [WebSocket Hibernation](https://developers.cloudflare.com/durable-objects/best-practices/websockets/): `acceptWebSocket` and handler methods allow idle objects to hibernate without disconnecting peers.
- [Alarms](https://developers.cloudflare.com/durable-objects/api/alarms/): persisted scheduled cleanup is available; alarms may be delayed/retried, so request handlers independently enforce deadlines.
- [Durable Object class exports/migrations](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/): the initial SQLite class registration uses `new_sqlite_classes`.
- [Pages build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/) and [Pages headers](https://developers.cloudflare.com/pages/configuration/headers/): Vite outputs static assets plus `_headers`.

Recheck these pages at deployment; quotas and billing can change. Room metadata and per-IP counters consume temporary SQLite storage/operations; transfer bytes do not. Alarms and application heartbeat messages consume request quotas. Approximate a 24-hour two-device session at 11,520 client heartbeats, 5,760 room liveness sweeps plus SQLite operations; this implementation prioritizes closure detection over absolute minimum signaling costs. Hibernation avoids billing all idle connection time. Multiple rooms may hit quotas; shared IP creation limits cap rapid creation, not total traffic globally.

## 1. Configure and deploy the Worker

From repository root:

```sh
npm ci
npx wrangler login
```

In `apps/signaling/wrangler.jsonc`, change `ALLOWED_ORIGINS` to your exact frontend HTTPS origin, for example `https://from-computer-to-phone.pages.dev`. Add your custom domain origin if used. Keep `SESSION_TTL_SECONDS` at 86400 and `HOST_GRACE_SECONDS` at 15. Do not remove either SQLite migration/class binding. Set STUN_URLS to a comma-separated list of STUN URLs; the default uses Cloudflare's STUN service.

```sh
npm run deploy:api
```

Save the Worker URL printed by Wrangler. A Worker health request without an approved Origin deliberately returns 403; test the POST route with an approved Origin instead. No content database or R2 bucket is needed. The `ROOMS` and `LIMITER` bindings are created by the SQLite migration.

## 2. Deploy Pages from GitHub

In Cloudflare dashboard → Workers & Pages → Create application → Pages → connect `RecepU/FromComputerToPhone`.

| Setting           | Value                                             |
| ----------------- | ------------------------------------------------- |
| Production branch | `main`                                            |
| Root directory    | repository root (blank)                           |
| Build command     | `npm run build`                                   |
| Output directory  | `apps/web/dist`                                   |
| NODE_VERSION      | `22.22.0` or a current compatible Node 22 release |
| VITE_API_URL      | actual `https://…workers.dev` signaling URL       |

Frontend API URL is public configuration, not a secret. Vite config generates the deployed `_headers` CSP from it. Rebuild Pages whenever it changes. Pages handles HTTPS and SPA fallback for `/join/<id>` because there is no top-level 404.html. Do not configure redirects that remove the URL fragment before browser initialization. Verify `_headers` are applied with the browser network inspector.

First deployment ordering: choose the Pages project hostname, allowlist that origin in Worker, deploy Worker, then build Pages with its real Worker URL. If the dashboard assigns a different hostname, update the Worker allowlist and redeploy. Preview Pages hostnames are not automatically trusted; add only explicit origins you intend to use, or keep backend integration previews local.

## 3. Optional TURN

Use your own coturn-compatible server/provider supporting TURN REST HMAC-SHA1 shared-secret credentials. It must accept timestamp-prefixed usernames and provide public UDP/TCP/TLS relay ports. Configure the relay independently, including firewall, TLS certificates, realm and bandwidth limits.

Set `TURN_URLS` in Worker vars to a comma-separated list such as `turn:relay.example.com:3478,turns:relay.example.com:5349`. Set the shared secret securely:

```sh
npx wrangler secret put TURN_SECRET --config apps/signaling/wrangler.jsonc
```

Enter the existing relay secret when prompted, then redeploy. Never put the shared secret in VITE variables. Authenticated peers receive one-hour credentials. Relay traffic can incur hosting/bandwidth costs. The MVP does not provision a relay or promise free cellular-to-Wi-Fi transfer on restrictive networks.

## 4. Domain and verification

Add a Pages custom domain in the dashboard and wait for HTTPS issuance. Add its exact HTTPS origin to `ALLOWED_ORIGINS`, redeploy the Worker, and rebuild Pages if the backend hostname changes. Use Worker custom-domain routing if desired; keep frontend VITE_API_URL aligned.

Run the checklist in [MANUAL_TESTS.md](MANUAL_TESTS.md). Verify QR points to the public HTTPS frontend, WSS authorization succeeds, data channel opens, transfers arrive, download/copy work, a third device is rejected, old QR cannot rejoin after termination, headers contain the configured Worker and no wildcard origin is accepted. Test desktop Wi-Fi vs cellular with and without TURN. Check dashboard usage without logging transfer content.

## CI and deployment credentials

GitHub Actions validates PRs without Cloudflare secrets: npm ci, lint, strict typechecking, unit/UI tests, build, real local Worker integration and Chromium E2E. Pages Git integration can deploy after repository changes according to your Cloudflare project settings; enable that only when ready. There is no automatic production deployment workflow in this repo.

For future manual-token CI deployment, use a narrowly scoped Cloudflare API token granting Workers Scripts Edit, account Durable Objects access and Cloudflare Pages Edit as required by your deployment method. Store `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` as GitHub secrets, never commit them. Wrangler login is sufficient for the interactive procedure above. Domains and TURN may cost money; free-tier quota failures and account-specific availability must be checked before launch.
