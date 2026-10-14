# Same-Wi-Fi local POC (default)

Local mode needs no Cloudflare account, STUN/TURN, WebRTC or hosting. The original cloud implementation is preserved as a separate mode.

## 1. Start on Windows

Install Node.js 22.13 or newer. Double-click `start-local.bat`. It installs dependencies on first use, builds the local frontend, starts Node, prints localhost/LAN URLs and opens the desktop browser. Internet is needed for initial package installation only. Keep the console open.

PowerShell alternative:

```powershell
cd "C:\Users\User1\OneDrive\Documents\ChatGPT\FromComputerToPhone"
npm.cmd ci
npm.cmd run dev
```

Open `http://localhost:3000`. Subsequent starts do not need npm ci. If EBUSY occurs, stop development servers and pause OneDrive synchronization before reinstalling. Consider a folder outside OneDrive if locking recurs.

## 2. Connect the phone

Connect both devices to the same trusted Wi-Fi. Scan the desktop QR using the phone's Camera application. The QR points to the Windows LAN address. Keep both pages open; QR hides after connection. Send text/links/images in either direction. Copy and download are explicit actions.

Guest Leave Session preserves the host and rotates the QR. Scan the new QR to reconnect; previous guest credentials stop working. Host End Session clears both peers and revokes the room. Restarting Node loses all rooms. New visits create new rooms.

## 3. LAN address and configuration

The server prints private IPv4 adapters and prefers adapters without VPN/virtual/WSL names. Selection is a heuristic. Run `ipconfig` and use the connected Wi-Fi adapter's IPv4 address, usually 192.168.x.x or 10.x.x.x.

```powershell
$env:LAN_IP = '192.168.1.96' # replace with YOUR Wi-Fi address
$env:PORT = '3000'
npm.cmd run dev
```

Or run `start-local.bat 192.168.1.96`. The override must be assigned to an actual private IPv4 adapter. Use `LAN_IP=127.0.0.1` only for computer-only tests. Defaults: PORT=3000, HOST_GRACE_SECONDS=15, SESSION_TTL_SECONDS=86400, MAX_IMAGE_BYTES=10485760. TTL cannot exceed 24 hours. Image limit can be lowered, up to the shared protocol's 10 MiB ceiling. Larger future limits require updating that ceiling.

Node binds 0.0.0.0 but accepts only configured LAN/localhost hosts, exact HTTP origins and private/loopback client IPs. Other adapter addresses are not automatically trusted. HTTP/WS is unencrypted; these checks do not authenticate the Wi-Fi network.

## 4. Windows Firewall

On trusted home Wi-Fi, Windows Settings → Network & Internet → Wi-Fi → your network → Network profile: **Private**. When Firewall asks about Node.js, allow **Private only**, leave Public unchecked. Do not disable the firewall.

If no prompt appears: Windows Security → Firewall & network protection → Allow an app through firewall → Change settings. Allow your installed Node.js executable (usually C:\Program Files\nodejs\node.exe) on Private only. For a narrower rule, Windows Defender Firewall with Advanced Security → inbound TCP rule for your PORT, Private profile only, remote-address scope **Local subnet**. Managed PCs may need administrator help.

Try the printed LAN URL directly on the phone. If it cannot load, check the selected IP, firewall, VPNs, and router guest-network/client-isolation settings. Same Wi-Fi name may still isolate clients. If a port is occupied, stop the older server or change PORT; QR configuration follows automatically.

Never enable router port forwarding, public tunnels or Public firewall exceptions for this POC.

## 5. Stop

Press Ctrl+C in the console. Graceful shutdown notifies peers and clears rooms. Closing the console forcibly stops it too. Host disconnects use the configured grace period; silent network loss additionally needs up to 45 seconds of heartbeat detection. Browser/OS background suspension can end legitimate sessions.

## 6. Browser and privacy limits

Use trusted Wi-Fi: HTTP/WS traffic and credentials are observable by parties able to inspect the network. Node relays content transiently. Only bounded room metadata, streaming digest state and transient socket buffers exist; no database, content logs, uploads, service worker or offline cache. Shared browser content is bounded in-memory. User-created downloads/copies cannot be erased by the website.

On phone HTTP origins Clipboard API writes may be blocked. Copy reveals a read-only text area: tap, select text and use the OS Copy action. Browser selection behavior varies. iOS downloads may use preview/share/save flows. No automatic clipboard access or extra website permissions are requested. Camera scanning uses the existing phone camera app. Local SHA-256 and UUID generation work without secure-context subtle/randomUUID APIs; random generation uses crypto.getRandomValues.

Physical iPhone/Android, camera scanning, Windows Firewall prompts and router-specific connectivity still need manual testing. Automated Chromium LAN tests are not physical-phone certification.

## Tests and switching modes

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npx.cmd playwright install chromium
npm.cmd run test:e2e
```

Stop local servers first; local E2E uses 3000/3001. Backend unit tests use an injected clock for original 24-hour expiry and host grace. Original protocol, transfer, session and UI tests remain.

Preserved cloud mode:

```powershell
npm.cmd run dev:cloud
npm.cmd run build:cloud
npm.cmd run test:e2e:cloud
```

Cloud E2E uses original playwright.config.ts and ports 5173/8787/8788. Production instructions remain in DEPLOYMENT.md; no cloud deployment is performed. `services/mode.ts` selects cloud `session.ts` or local `local-session.ts`. The WebSocket adapter reuses Transfer with optional local crypto/size settings; cloud defaults are unchanged. Local builds use dist-local, cloud builds use original dist. The default local command deliberately serves built assets from one process; rebuild/restart after editing frontend files.
