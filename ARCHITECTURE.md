# Architecture

## Additional local POC mode

Default local mode serves `apps/web/dist-local` and `/api/local` HTTP/WebSockets from `apps/local/src` on one Node process. Memory-only rooms relay validated text and binary chunks; streaming SHA-256 state validates image bytes without retaining entire images. `services/mode.ts` selects the session implementation and reuses the QR, feed, transfer and UI components. See [LOCAL_SETUP.md](LOCAL_SETUP.md).

The existing cloud architecture below remains optional. Its original backend, WebRTC service and `dist` output are preserved.

## Transport and trust

The static Pages frontend creates a room by POSTing to the Worker. The Worker selects a cryptographically random Durable Object name and calls its internal `/create` endpoint. Public clients cannot initialize a chosen or previously terminated room. A room stores only hashes of its two capabilities, absolute expiry, pairing expiry and host disconnection deadline in its SQLite-backed Durable Object storage. These lifecycle records are deleted when the room ends. They survive runtime hibernation/restart so server expiry and host ownership remain enforceable. No text, files or SDP is stored in this storage.

Each browser opens an origin-checked WebSocket, authenticates in the first message, and gets a single role slot. Credentials are never query parameters or WebSocket subprotocols. WebSocket attachments hold role, liveness and rate-window state for hibernation. The object uses `acceptWebSocket` and event handlers instead of permanently active socket callbacks.

The host offers a peer connection. The backend forwards validated offers, answers and ICE candidates only to the other authorized role. Candidates are queued until a remote description exists. A reliable ordered DataChannel carries all transfers directly between devices or through the configured TURN relay. UI says Connected only when this data channel is open. Signaling reconnection is bounded to three attempts. Explicit Retry can initiate a new handshake; disconnected peer connections, timers and transfer buffers are disposed.

## Lifecycle

Creation fixes an expiry at no more than 24 hours. The first host socket must authenticate within its grace period. A guest QR lasts ten minutes or until room expiry. Backend checks expiry before every room action and schedules an alarm at the earliest lifetime/grace deadline, with liveness sweeps at most every 15 seconds. Pending sockets are evicted and active sockets need heartbeats at least every 45 seconds. Server-side access cannot continue after the deadline even if an alarm delivery is delayed; a late alarm may delay the disconnected client's UI notice.

Guest disconnect rotates the guest capability and tells the host to display its new QR. Old QR credentials cannot reconnect. A host network interruption can reconnect with the same in-memory host capability within grace. Host page reload creates a new room; credentials are not restored across visits. Host end or expiry broadcasts a terminal event, closes sockets and deletes lifecycle records/alarms. With no record, every subsequent request is rejected; only the Worker can create a new, independently random room.

Explicit host End requires acknowledgment from the backend before declaring success. Guest Leave clears its own feed and socket while preserving host ownership. Browser pagehide attempts host termination without depending on delivery. Silent loss and browser suspension are detected through heartbeat deadlines. No application can guarantee immediate remote cleanup at the exact instant of tab closure.

The frontend mirrors the server's absolute deadline so an offline page also clears its content at expiry. It additionally clears its local feed on signaling disconnection while retaining only in-memory capability authorization for bounded reconnect attempts. The server remains authoritative. TURN credentials are refreshed through an authenticated `/ice` endpoint before every negotiation; a guest may request them only while its authenticated slot exists.

## Transfer protocol

Text is a strict JSON envelope with UUID, timestamp and text. Receiver acknowledges receipt; sender adds the confirmed item to its feed. IDs are deduplicated within a bounded 256-ID window. No automated resend is performed.

Images begin with a JSON envelope containing UUID, filename, MIME, size and SHA-256. Each binary packet is 36 ASCII UUID bytes + a 4-byte big-endian sequence number + up to 16,344 payload bytes, keeping the complete frame at most 16 KiB. Receiver enforces exact sequence, declared size, permitted MIME, format signature and final hash. Download filenames are sanitized and given an extension matching the image MIME; original image bytes are unchanged. Sender pauses when bufferedAmount exceeds 256 KiB and resumes on bufferedamountlow at 64 KiB. Receive timeout is 30 seconds without a chunk; sender stall timeout is ten seconds; completion acknowledgment timeout is 30 seconds. One incoming and one outgoing image per connection are permitted, with independent progress and cancellation, so bidirectional transfers are possible without unbounded accumulation. A cancel envelope clears buffers, backpressure listeners and pending confirmation immediately.

Blob URLs exist only in the browser feed. They are revoked when the session clears or an item is evicted. Aggregate feed image memory is bounded; temporary transfer buffers add up to roughly 20–40 MiB during an image handshake. Large image decoding can consume additional browser memory; the format/size checks are not a malware scanner or a universal decompression-bomb defense.

## Extension points

Shared schemas separate transport from rendering. Native clients can implement the same signaling and transfer protocol. More devices would require an explicit occupancy/protocol revision; the current role filtering intentionally enforces two peers. There is no database, service worker, background clipboard access, persistence adapter, account system or upload fallback.
