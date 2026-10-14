import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import {
  randomBytes,
  timingSafeEqual,
  createHash,
  type Hash,
} from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { WebSocketServer, WebSocket } from 'ws';
import {
  CHUNK_SIZE,
  MAX_FILE_SIZE,
  tokenSchema,
  validImageSignature,
  type Role,
} from '../../../packages/shared/protocol';
import { localClientSchema } from '../../../packages/shared/local-protocol';
import { privateAddress } from './network';
export interface LocalConfig {
  lanIp: string;
  port: number;
  dist: string;
  ttlMs?: number;
  graceMs?: number;
  pairMs?: number;
  maxFileSize?: number;
  now?: () => number;
}
interface Upload {
  id: string;
  size: number;
  received: number;
  sequence: number;
  hash: Hash;
  sha256: string;
  mime: string;
  first: Buffer;
  deadline: number;
}
interface Client {
  ws: WebSocket;
  room: Room;
  role?: Role;
  last: number;
  authDeadline: number;
  rateAt: number;
  count: number;
  bytesAt: number;
  bytes: number;
  upload?: Upload;
  pending: Map<string, number>;
}
interface Room {
  id: string;
  hostSecret: string;
  guestSecret: string;
  expires: number;
  pairExpires: number;
  host?: Client;
  guest?: Client;
  hostGone: number;
  clients: Set<Client>;
}
const token = () => randomBytes(32).toString('base64url');
const equal = (a: string, b: string) =>
  a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function createLocalServer(config: LocalConfig) {
  const now = config.now ?? Date.now;
  const ttl = Math.min(86400000, Math.max(1, config.ttlMs ?? 86400000));
  const grace = Math.max(1, config.graceMs ?? 15000),
    pairMs = Math.min(ttl, config.pairMs ?? 600000);
  const maxFileSize = Math.min(
    MAX_FILE_SIZE,
    Math.max(1, config.maxFileSize ?? MAX_FILE_SIZE),
  );
  const rooms = new Map<string, Room>(),
    clients = new Set<Client>();
  const rates = new Map<string, { start: number; count: number }>();
  const dist = resolve(config.dist);
  const hosts = new Set(['localhost', '127.0.0.1', config.lanIp]);
  const origins = new Set([...hosts].map((h) => `http://${h}:${config.port}`));
  function send(c: Client | undefined, m: unknown) {
    if (c?.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify(m));
  }
  function end(
    room: Room,
    reason: 'ended' | 'expired' | 'host-disconnected' | 'server-stopped',
  ) {
    if (!rooms.delete(room.id)) return;
    for (const c of room.clients) {
      send(c, { type: 'ended', reason });
      c.upload = undefined;
      c.pending.clear();
      c.ws.close(1000);
    }
    room.hostSecret = '';
    room.guestSecret = '';
    room.clients.clear();
    room.host = undefined;
    room.guest = undefined;
  }
  function rotate(room: Room) {
    room.guestSecret = token();
    room.pairExpires = Math.min(room.expires, now() + pairMs);
    send(room.host, {
      type: 'pairing',
      secret: room.guestSecret,
      pairExpires: room.pairExpires,
    });
  }
  function active(room: Room) {
    if (now() >= room.expires) {
      end(room, 'expired');
      return false;
    }
    if (!room.host && now() - room.hostGone >= grace) {
      end(room, 'host-disconnected');
      return false;
    }
    return rooms.has(room.id);
  }
  function safeRequest(req: IncomingMessage) {
    const host = req.headers.host ?? '';
    if (
      !hosts.has(host.split(':')[0]) ||
      host !== `${host.split(':')[0]}:${config.port}`
    )
      return false;
    if (!privateAddress(req.socket.remoteAddress ?? '')) return false;
    return !req.headers.origin || origins.has(req.headers.origin);
  }
  function limit(req: IncomingMessage, kind: string, max: number) {
    const key = `${req.socket.remoteAddress}:${kind}`,
      time = now();
    let rate = rates.get(key);
    if (!rate || time - rate.start >= 60000) {
      rate = { start: time, count: 0 };
      rates.set(key, rate);
    }
    return ++rate.count <= max;
  }
  function reply(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  }
  const server = createServer((req, res) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) reply(res, 500, { error: 'Local server error' });
      else res.destroy();
    });
  });
  async function handle(req: IncomingMessage, res: ServerResponse) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader(
      'Content-Security-Policy',
      `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ${[...hosts].map((h) => `ws://${h}:${config.port}`).join(' ')}; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`,
    );
    if (!safeRequest(req)) {
      reply(res, 403, { error: 'Local network access only' });
      return;
    }
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path.startsWith('/api/')) {
      if (
        req.method !== 'POST' ||
        !req.headers.origin ||
        !limit(req, 'api', 120)
      ) {
        reply(res, 403, { error: 'Invalid request' });
        return;
      }
      if (
        Number(req.headers['content-length'] ?? 0) > 0 ||
        req.headers['transfer-encoding']
      ) {
        req.resume();
        reply(res, 413, { error: 'Unexpected body' });
        return;
      }
      if (path === '/api/local/rooms') {
        if (!limit(req, 'create', 30) || rooms.size >= 100) {
          reply(res, 429, { error: 'Room limit reached' });
          return;
        }
        const time = now();
        const room: Room = {
          id: token(),
          hostSecret: token(),
          guestSecret: token(),
          expires: time + ttl,
          pairExpires: time + pairMs,
          hostGone: time,
          clients: new Set(),
        };
        rooms.set(room.id, room);
        reply(res, 201, {
          room: room.id,
          host: room.hostSecret,
          guest: room.guestSecret,
          expires: room.expires,
          pairExpires: room.pairExpires,
          pairOrigin: `http://${config.lanIp}:${config.port}`,
          maxFileSize,
        });
        return;
      }
      const m = /^\/api\/local\/rooms\/([A-Za-z0-9_-]{43})\/end$/.exec(path),
        room = m ? rooms.get(m[1]) : undefined;
      if (!room || !active(room)) {
        reply(res, 404, { error: 'Room unavailable' });
        return;
      }
      const secret = (req.headers.authorization ?? '').replace(/^Bearer /, '');
      if (
        !tokenSchema.safeParse(secret).success ||
        !equal(secret, room.hostSecret)
      ) {
        reply(res, 403, { error: 'Unauthorized' });
        return;
      }
      end(room, 'ended');
      reply(res, 200, { ended: true });
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      reply(res, 405, { error: 'Method unavailable' });
      return;
    }
    let file = resolve(dist, `.${decodeURIComponent(path)}`);
    if (file !== dist && !file.startsWith(dist + sep)) {
      reply(res, 404, { error: 'Not found' });
      return;
    }
    if (path === '/' || /^\/join\/[A-Za-z0-9_-]{43}\/?$/.test(path))
      file = resolve(dist, 'index.html');
    try {
      if (!(await stat(file)).isFile()) throw new Error();
      const bytes = await readFile(file);
      const mime: Record<string, string> = {
        '.html': 'text/html; charset=utf-8',
        '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.ico': 'image/x-icon',
      };
      res.writeHead(200, {
        'Content-Type': mime[extname(file)] ?? 'application/octet-stream',
      });
      res.end(req.method === 'HEAD' ? undefined : bytes);
    } catch {
      reply(res, 404, { error: 'Not found. Build the local frontend first.' });
    }
  }
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 65536,
    perMessageDeflate: false,
  });
  server.on('upgrade', (req, socket, head) => {
    const m = /^\/api\/local\/rooms\/([A-Za-z0-9_-]{43})\/socket$/.exec(
      req.url ?? '',
    );
    const room = m ? rooms.get(m[1]) : undefined;
    if (
      !safeRequest(req) ||
      !req.headers.origin ||
      !limit(req, 'socket', 120) ||
      !room ||
      !active(room) ||
      room.clients.size >= 4 ||
      clients.size >= 64
    ) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      const time = now(),
        c: Client = {
          ws,
          room,
          last: time,
          authDeadline: time + 5000,
          rateAt: time,
          count: 0,
          bytesAt: time,
          bytes: 0,
          pending: new Map(),
        };
      room.clients.add(c);
      clients.add(c);
      ws.on('error', () => {});
      ws.on('message', (raw, binary) => {
        if (ws.readyState !== WebSocket.OPEN) return;
        try {
          const rawBytes = Array.isArray(raw)
            ? Buffer.concat(raw)
            : Buffer.from(raw as Buffer);
          if (!active(room)) return;
          const time = now();
          if (time - c.bytesAt > 1000) {
            c.bytesAt = time;
            c.bytes = 0;
          }
          c.bytes += rawBytes.length;
          if (c.bytes > 24 * 1024 * 1024) throw new Error('Rate');
          c.last = time;
          if (binary) {
            if (!c.role || !room.host || !room.guest || !c.upload)
              throw new Error('Unauthorized binary');
            const b = rawBytes,
              u = c.upload;
            if (
              b.length <= 40 ||
              b.length > CHUNK_SIZE + 40 ||
              b.subarray(0, 36).toString() !== u.id ||
              b.readUInt32BE(36) !== u.sequence++ ||
              u.received + b.length - 40 > u.size
            )
              throw new Error('Invalid chunk');
            const bytes = b.subarray(40);
            u.received += bytes.length;
            u.hash.update(bytes);
            u.deadline = time + 30000;
            if (u.first.length < 12)
              u.first = Buffer.concat([u.first, bytes]).subarray(0, 12);
            relay(c, b, true);
            return;
          }
          if (time - c.rateAt > 10000) {
            c.rateAt = time;
            c.count = 0;
          }
          if (++c.count > 200) throw new Error('Rate');
          const m = localClientSchema.parse(JSON.parse(rawBytes.toString()));
          if (!c.role) {
            if (m.type !== 'auth') throw new Error('Authenticate first');
            if (m.role === 'host') {
              if (room.host || !equal(m.secret, room.hostSecret))
                throw new Error('Unauthorized host');
              c.role = 'host';
              room.host = c;
              room.hostGone = 0;
            } else {
              if (
                !room.host ||
                room.guest ||
                time >= room.pairExpires ||
                !equal(m.secret, room.guestSecret)
              )
                throw new Error('Unauthorized guest');
              c.role = 'guest';
              room.guest = c;
            }
            send(c, {
              type: 'welcome',
              expires: room.expires,
              pairExpires: room.pairExpires,
              maxFileSize,
              connected: !!room.host && !!room.guest,
            });
            if (c.role === 'host')
              send(c, {
                type: 'pairing',
                secret: room.guestSecret,
                pairExpires: room.pairExpires,
              });
            if (room.host && room.guest)
              send(c.role === 'guest' ? room.host : room.guest, {
                type: 'connected',
              });
            return;
          }
          if (m.type === 'auth') throw new Error('Already authenticated');
          if (m.type === 'heartbeat') {
            send(c, { type: 'heartbeat' });
            return;
          }
          if (m.type === 'rotate') {
            if (c.role !== 'host' || room.guest)
              throw new Error('Cannot rotate');
            rotate(room);
            return;
          }
          if (m.type === 'data') {
            if (!room.host || !room.guest) throw new Error('Peer disconnected');
            const p = m.payload;
            if (p.type === 'file') {
              if (c.upload || p.size > maxFileSize)
                throw new Error('Image limit');
              c.upload = {
                id: p.id,
                size: p.size,
                received: 0,
                sequence: 0,
                hash: createHash('sha256'),
                sha256: p.sha256,
                mime: p.mime,
                first: Buffer.alloc(0),
                deadline: time + 30000,
              };
            } else if (p.type === 'complete') {
              const u = c.upload;
              if (
                !u ||
                u.id !== p.id ||
                u.received !== u.size ||
                u.hash.digest('hex') !== u.sha256 ||
                !validImageSignature(u.first, u.mime)
              )
                throw new Error('Invalid image');
              c.upload = undefined;
            } else if (p.type === 'cancel') {
              if (c.upload?.id === p.id) c.upload = undefined;
              const peer = c.role === 'host' ? room.guest : room.host;
              if (peer?.upload?.id === p.id) peer.upload = undefined;
              c.pending.delete(p.id);
              peer?.pending.delete(p.id);
            } else if (p.type === 'text') {
              if (c.pending.size >= 64 || c.pending.has(p.id))
                throw new Error('Transfer limit');
              c.pending.set(p.id, time + 30000);
            } else if (p.type === 'ack') {
              const peer = c.role === 'host' ? room.guest : room.host;
              peer?.pending.delete(p.id);
            }
            relay(c, JSON.stringify(m), false);
          }
        } catch {
          c.ws.close(1008, 'Invalid or unauthorized request');
        }
      });
      ws.on('close', () => {
        clients.delete(c);
        room.clients.delete(c);
        c.upload = undefined;
        c.pending.clear();
        if (!rooms.has(room.id)) return;
        if (room.host === c) {
          room.host = undefined;
          room.hostGone = now();
          if (room.guest) {
            room.guest.upload = undefined;
            room.guest.pending.clear();
          }
          send(room.guest, { type: 'peer-disconnected' });
        }
        if (room.guest === c) {
          room.guest = undefined;
          if (room.host) {
            room.host.upload = undefined;
            room.host.pending.clear();
          }
          send(room.host, { type: 'peer-disconnected' });
          rotate(room);
        }
      });
    });
  });
  function relay(c: Client, data: string | Buffer, binary: boolean) {
    const peer = c.role === 'host' ? c.room.guest : c.room.host;
    if (!peer || peer.ws.readyState !== WebSocket.OPEN)
      throw new Error('Peer disconnected');
    if (peer.ws.bufferedAmount > 1024 * 1024) {
      peer.ws.close(1008, 'Transfer stalled');
      throw new Error('Backpressure');
    }
    peer.ws.send(data, { binary });
  }
  function sweep() {
    for (const room of rooms.values())
      if (active(room)) {
        if (!room.guest && now() >= room.pairExpires) rotate(room);
        for (const c of room.clients) {
          if ((!c.role && now() >= c.authDeadline) || now() - c.last > 45000)
            c.ws.terminate();
          if (c.upload && now() > c.upload.deadline) {
            const id = c.upload.id;
            c.upload = undefined;
            send(c, { type: 'data', payload: { type: 'cancel', id } });
            send(c.role === 'host' ? room.guest : room.host, {
              type: 'data',
              payload: { type: 'cancel', id },
            });
          }
          for (const [id, deadline] of c.pending)
            if (now() > deadline) c.pending.delete(id);
        }
      }
    for (const [key, r] of rates)
      if (now() - r.start > 60000) rates.delete(key);
  }
  const timer = setInterval(sweep, 250);
  timer.unref();
  async function close() {
    clearInterval(timer);
    for (const r of rooms.values()) end(r, 'server-stopped');
    // Give the terminal notification a brief chance to flush before force cleanup.
    if (clients.size) await new Promise<void>((done) => setTimeout(done, 100));
    for (const c of clients) c.ws.terminate();
    await new Promise<void>((done) => wss.close(() => done()));
    await new Promise<void>((done) => server.close(() => done()));
  }
  return { server, rooms, sweep, close, ttl, maxFileSize };
}
