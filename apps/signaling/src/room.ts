import { DurableObject } from 'cloudflare:workers';
import { authSchema, signalSchema } from '../../../packages/shared/protocol';
import {
  hashSecret,
  iceServers,
  lifetime,
  matches,
  secureToken,
} from './security';
import type { Env, Metadata, SocketInfo } from './types';
export class Room extends DurableObject<Env> {
  private sockets(role?: string): WebSocket[] {
    return this.ctx
      .getWebSockets()
      .filter((w) => !role || this.info(w).role === role);
  }
  private info(w: WebSocket): SocketInfo {
    return w.deserializeAttachment() as SocketInfo;
  }
  private send(w: WebSocket, value: unknown): void {
    try {
      w.send(JSON.stringify(value));
    } catch {
      w.close(1011, 'Connection interrupted');
    }
  }
  private broadcast(value: unknown): void {
    for (const w of this.sockets()) this.send(w, value);
  }
  private async save(m: Metadata): Promise<void> {
    await this.ctx.storage.put('room', m);
    await this.schedule(m);
  }
  private async schedule(m: Metadata): Promise<void> {
    await this.ctx.storage.setAlarm(
      Math.min(
        m.expires,
        Date.now() + 15000,
        m.hostGone === null
          ? Infinity
          : m.hostGone + lifetime(this.env.HOST_GRACE_SECONDS, 15, 60),
      ),
    );
  }
  private async live(): Promise<Metadata | undefined> {
    const m = await this.ctx.storage.get<Metadata>('room');
    if (
      m &&
      (Date.now() >= m.expires ||
        (m.hostGone !== null &&
          Date.now() >=
            m.hostGone + lifetime(this.env.HOST_GRACE_SECONDS, 15, 60)))
    ) {
      await this.end(Date.now() >= m.expires ? 'expired' : 'ended');
      return;
    }
    return m;
  }
  private async end(reason: string): Promise<void> {
    this.broadcast({ type: 'ended', reason });
    for (const w of this.sockets()) w.close(1000, 'Session ended');
    await this.ctx.storage.deleteAll();
    await this.ctx.storage.deleteAlarm();
  }
  async fetch(request: Request): Promise<Response> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const path = new URL(request.url).pathname;
      if (path === '/create') {
        if (await this.ctx.storage.get('room'))
          return new Response('Conflict', { status: 409 });
        const host = secureToken(),
          guest = secureToken(),
          expires =
            Date.now() + lifetime(this.env.SESSION_TTL_SECONDS, 86400, 86400);
        const m: Metadata = {
          hostHash: await hashSecret(host),
          guestHash: await hashSecret(guest),
          expires,
          pairExpires: Math.min(expires, Date.now() + 600000),
          hostGone: Date.now(),
        };
        await this.save(m);
        return Response.json({
          host,
          guest,
          expires,
          pairExpires: m.pairExpires,
        });
      }
      const m = await this.live();
      if (!m) return new Response('Session unavailable', { status: 404 });
      if (path === '/ice' && request.method === 'POST') {
        const secret =
          request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
        const host = await matches(secret, m.hostHash);
        const guest =
          this.sockets('guest').length > 0 &&
          (await matches(secret, m.guestHash));
        if (!host && !guest)
          return new Response('Unauthorized', { status: 403 });
        return Response.json({ iceServers: await iceServers(this.env) });
      }
      if (path === '/end' && request.method === 'POST') {
        const secret =
          request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
        if (!(await matches(secret, m.hostHash)))
          return new Response('Unauthorized', { status: 403 });
        await this.end('ended');
        return new Response(null, { status: 204 });
      }
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket')
        return new Response('Not found', { status: 404 });
      if (this.sockets().length >= 4)
        return new Response('Connection limit', { status: 429 });
      const pair = new WebSocketPair();
      const client = pair[0],
        server = pair[1];
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({
        since: Date.now(),
        lastSeen: Date.now(),
        window: Date.now(),
        count: 0,
      } satisfies SocketInfo);
      await this.schedule(m);
      return new Response(null, { status: 101, webSocket: client });
    });
  }
  async webSocketMessage(
    ws: WebSocket,
    raw: string | ArrayBuffer,
  ): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      const m = await this.live();
      if (!m) {
        ws.close(1008, 'Session unavailable');
        return;
      }
      const info = this.info(ws);
      if (
        typeof raw !== 'string' ||
        raw.length > 32768 ||
        new TextEncoder().encode(raw).length > 32768
      ) {
        ws.close(1009, 'Message too large');
        return;
      }
      if (Date.now() - info.window > 10000) {
        info.window = Date.now();
        info.count = 0;
      }
      if (++info.count > 100) {
        ws.close(1008, 'Rate limit');
        return;
      }
      let input: unknown;
      try {
        input = JSON.parse(raw);
      } catch {
        ws.close(1008, 'Invalid message');
        return;
      }
      if (!info.role) {
        const parsed = authSchema.safeParse(input);
        if (!parsed.success) {
          ws.close(1008, 'Invalid authorization');
          return;
        }
        const { role, secret } = parsed.data;
        if (
          !(await matches(
            secret,
            role === 'host' ? m.hostHash : m.guestHash,
          )) ||
          (role === 'guest' && Date.now() >= m.pairExpires)
        ) {
          this.send(ws, {
            type: 'error',
            message: 'Invalid or expired pairing credentials.',
          });
          ws.close(1008, 'Unauthorized');
          return;
        }
        if (this.sockets(role).length) {
          this.send(ws, {
            type: 'error',
            message: 'This session already has that device connected.',
          });
          ws.close(1008, 'Occupied');
          return;
        }
        if (role === 'guest' && !this.sockets('host').length) {
          this.send(ws, {
            type: 'error',
            message:
              'The computer is disconnected. Scan a new QR when it returns.',
          });
          ws.close(1008, 'Host unavailable');
          return;
        }
        info.role = role;
        info.lastSeen = Date.now();
        ws.serializeAttachment(info);
        if (role === 'host') {
          m.hostGone = null;
          await this.save(m);
        }
        this.send(ws, {
          type: 'welcome',
          role,
          expires: m.expires,
          iceServers: await iceServers(this.env),
        });
        if (
          role === 'host' &&
          !this.sockets('guest').length &&
          m.pairExpires <= Date.now()
        )
          await this.rotate(m);
        if (this.sockets('host').length && this.sockets('guest').length)
          this.broadcast({ type: 'peer-ready' });
        return;
      }
      const parsed = signalSchema.safeParse(input);
      if (!parsed.success) {
        ws.close(1008, 'Invalid signal');
        return;
      }
      info.lastSeen = Date.now();
      ws.serializeAttachment(info);
      const message = parsed.data;
      if (message.type === 'heartbeat') {
        this.send(ws, { type: 'heartbeat' });
        return;
      }
      if (message.type === 'end') {
        if (info.role === 'host') await this.end('ended');
        else ws.close(1008, 'Host privilege required');
        return;
      }
      if (message.type === 'rotate') {
        if (info.role !== 'host' || this.sockets('guest').length) {
          this.send(ws, {
            type: 'error',
            message: 'Disconnect the paired phone before creating a new QR.',
          });
          return;
        }
        await this.rotate(m);
        return;
      }
      if (
        (message.type === 'offer' && info.role !== 'host') ||
        (message.type === 'answer' && info.role !== 'guest')
      ) {
        ws.close(1008, 'Invalid role');
        return;
      }
      for (const peer of this.sockets(info.role === 'host' ? 'guest' : 'host'))
        this.send(peer, message);
    });
  }
  private async rotate(m: Metadata): Promise<void> {
    const secret = secureToken();
    m.guestHash = await hashSecret(secret);
    m.pairExpires = this.sockets('host').length
      ? Math.min(m.expires, Date.now() + 600000)
      : Date.now();
    await this.save(m);
    for (const host of this.sockets('host'))
      this.send(host, { type: 'pairing', secret, pairExpires: m.pairExpires });
  }
  async webSocketClose(
    ws: WebSocket,
    code: number,
    reason: string,
  ): Promise<void> {
    ws.close([1005, 1006, 1015].includes(code) ? 1000 : code, reason);
    await this.disconnected(ws);
  }
  async webSocketError(ws: WebSocket): Promise<void> {
    ws.close(1011, 'Connection interrupted');
    await this.disconnected(ws);
  }
  private async disconnected(ws: WebSocket): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      const m = await this.live();
      if (!m) return;
      const info = this.info(ws);
      if (info.role === 'host' && !this.sockets('host').some((w) => w !== ws)) {
        m.hostGone ??= Date.now();
        await this.save(m);
        this.broadcast({ type: 'peer-disconnected' });
      }
      if (
        info.role === 'guest' &&
        !this.sockets('guest').some((w) => w !== ws)
      ) {
        await this.rotate(m);
        this.broadcast({ type: 'peer-disconnected' });
      }
    });
  }
  async alarm(): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      const m = await this.live();
      if (!m) return;
      for (const ws of this.sockets()) {
        const i = this.info(ws);
        if (!i.role && Date.now() - i.since > 5000)
          ws.close(1008, 'Authorization timeout');
        else if (i.role && Date.now() - i.lastSeen > 45000) {
          ws.close(1001, 'Heartbeat timeout');
          if (i.role === 'host') m.hostGone ??= Date.now();
        }
      }
      if (!this.sockets('host').length) m.hostGone ??= Date.now();
      await this.save(m);
    });
  }
}
