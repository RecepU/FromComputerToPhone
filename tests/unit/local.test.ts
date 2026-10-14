import { beforeEach, afterEach, it, expect } from 'vitest';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createLocalServer } from '../../apps/local/src/server';
import { privateAddress, selectLan } from '../../apps/local/src/network';
import {
  localDigest,
  localUuid,
} from '../../apps/web/src/services/local-crypto';
import { createHash } from 'node:crypto';
let time = 0;
let app: ReturnType<typeof createLocalServer>;
let port = 23891;
let origin = '';
const sockets: WebSocket[] = [];
beforeEach(async () => {
  port++;
  origin = `http://127.0.0.1:${port}`;
  time = Date.now();
  app = createLocalServer({
    lanIp: '127.0.0.1',
    port,
    dist: 'apps/web/dist-local',
    graceMs: 1000,
    now: () => time,
  });
  app.server.listen(port, '127.0.0.1');
  await once(app.server, 'listening');
});
afterEach(async () => {
  for (const s of sockets) s.terminate();
  sockets.length = 0;
  await app.close();
});
async function create() {
  const r = await fetch(`${origin}/api/local/rooms`, {
    method: 'POST',
    headers: { Origin: origin },
  });
  expect(r.status).toBe(201);
  return r.json() as Promise<{
    room: string;
    host: string;
    guest: string;
    pairOrigin: string;
    expires: number;
  }>;
}
async function socket(room: string) {
  const ws = new WebSocket(
    `${origin.replace('http', 'ws')}/api/local/rooms/${room}/socket`,
    { origin },
  );
  sockets.push(ws);
  await once(ws, 'open');
  return ws;
}
async function auth(ws: WebSocket, role: string, secret: string) {
  const msg = once(ws, 'message');
  ws.send(JSON.stringify({ type: 'auth', role, secret }));
  return JSON.parse(String((await msg)[0]));
}
async function tick() {
  await new Promise((r) => setTimeout(r, 30));
}
it('creates unpredictable separate capabilities and authenticates one host/guest', async () => {
  const a = await create(),
    b = await create();
  expect(a.room).not.toBe(b.room);
  expect(a.host).not.toBe(a.guest);
  expect(a.pairOrigin).toBe(origin);
  expect(a.expires - time).toBe(86400000);
  const host = await socket(a.room);
  expect((await auth(host, 'host', a.host)).connected).toBe(false);
  const guest = await socket(a.room);
  expect((await auth(guest, 'guest', a.guest)).connected).toBe(true);
  const impostor = await socket(a.room),
    closed = once(impostor, 'close');
  impostor.send(
    JSON.stringify({ type: 'auth', role: 'host', secret: a.guest }),
  );
  expect((await closed)[0]).toBe(1008);
  const third = await socket(a.room),
    thirdClosed = once(third, 'close');
  third.send(JSON.stringify({ type: 'auth', role: 'guest', secret: a.guest }));
  expect((await thirdClosed)[0]).toBe(1008);
});
it('rotates guest credentials, rejects replay and prevents guest termination', async () => {
  const a = await create(),
    h = await socket(a.room);
  await auth(h, 'host', a.host);
  const g = await socket(a.room);
  await auth(g, 'guest', a.guest);
  const r = await fetch(`${origin}/api/local/rooms/${a.room}/end`, {
    method: 'POST',
    headers: { Origin: origin, Authorization: `Bearer ${a.guest}` },
  });
  expect(r.status).toBe(403);
  g.close();
  await once(g, 'close');
  await tick();
  const fresh = app.rooms.get(a.room)!.guestSecret;
  expect(fresh).not.toBe(a.guest);
  const old = await socket(a.room),
    closed = once(old, 'close');
  old.send(JSON.stringify({ type: 'auth', role: 'guest', secret: a.guest }));
  expect((await closed)[0]).toBe(1008);
  expect((await auth(await socket(a.room), 'guest', fresh)).connected).toBe(
    true,
  );
});
it('cleans host disconnect after grace and permanently rejects the old room', async () => {
  const a = await create(),
    h = await socket(a.room);
  await auth(h, 'host', a.host);
  h.close();
  await once(h, 'close');
  await tick();
  time += 1001;
  app.sweep();
  expect(app.rooms.has(a.room)).toBe(false);
  const denied = new WebSocket(
    `${origin.replace('http', 'ws')}/api/local/rooms/${a.room}/socket`,
    { origin },
  );
  sockets.push(denied);
  const error = await once(denied, 'error');
  expect(error[0]).toBeInstanceOf(Error);
});
it('expires at the original 24-hour deadline and broadcasts termination', async () => {
  const a = await create(),
    h = await socket(a.room);
  await auth(h, 'host', a.host);
  const ended = new Promise<unknown>((resolve) =>
    h.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type === 'ended') resolve(m);
    }),
  );
  time = a.expires;
  app.sweep();
  expect(await ended).toEqual({ type: 'ended', reason: 'expired' });
  expect(app.rooms.size).toBe(0);
});
it('rejects foreign origins and malformed messages', async () => {
  expect(
    (
      await fetch(`${origin}/api/local/rooms`, {
        method: 'POST',
        headers: { Origin: 'http://evil.example' },
      })
    ).status,
  ).toBe(403);
  const a = await create(),
    h = await socket(a.room);
  await auth(h, 'host', a.host);
  const closed = once(h, 'close');
  h.send('{');
  expect((await closed)[0]).toBe(1008);
});
it('HTTP-safe crypto preserves SHA-256 and secure UUID generation', async () => {
  const bytes = new TextEncoder().encode('HTTP LAN 🌍');
  expect(await localDigest(bytes.buffer)).toBe(
    createHash('sha256').update(bytes).digest('hex'),
  );
  expect(localUuid()).toMatch(
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
  );
  expect(privateAddress('::ffff:192.168.1.2')).toBe(true);
  expect(privateAddress('8.8.8.8')).toBe(false);
  expect(() => selectLan('8.8.8.8')).toThrow();
});
