import { joinCredentials } from '../../../../packages/shared/protocol';
import {
  localRoomSchema,
  localServerSchema,
} from '../../../../packages/shared/local-protocol';
import { Session, type SessionView } from './session';
import { Transfer } from './transfer';
import { WebSocketChannel } from './websocket-channel';
import { localDigest, localUuid } from './local-crypto';
export class LocalSession {
  transfer: Transfer | null = null;
  private socket: WebSocket | null = null;
  private channel: WebSocketChannel | null = null;
  private room = '';
  private secret = '';
  private origin = '';
  private maxFileSize = 10 * 1024 * 1024;
  private disposed = false;
  private attempts = 0;
  private lastBeat = 0;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private reconnect: ReturnType<typeof setTimeout> | null = null;
  private expiry: ReturnType<typeof setTimeout> | null = null;
  private view: SessionView = {
    status: 'Starting',
    role: 'host',
    pairUrl: '',
    pairExpires: 0,
    expires: 0,
    error: '',
    ended: false,
  };
  constructor(private options: ConstructorParameters<typeof Session>[0]) {}
  private update(change: Partial<SessionView>) {
    if (this.disposed || this.view.ended) return;
    this.view = { ...this.view, ...change };
    this.options.view(this.view);
  }
  private pair(guest: string) {
    this.update({ pairUrl: `${this.origin}/join/${this.room}#${guest}` });
  }
  async start() {
    try {
      if (location.pathname.startsWith('/join/')) {
        const c = joinCredentials(location.pathname, location.hash);
        if (!c)
          throw new Error('Invalid QR. Scan a new code on your computer.');
        this.room = c.room;
        this.secret = c.secret;
        history.replaceState(null, '', location.pathname);
        this.update({ role: 'guest' });
      } else {
        const response = await fetch('/api/local/rooms', {
          method: 'POST',
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok)
          throw new Error('Could not create a room. Check the local server.');
        const d = localRoomSchema.parse(await response.json());
        if (this.disposed) return;
        this.room = d.room;
        this.secret = d.host;
        this.origin = d.pairOrigin;
        this.maxFileSize = d.maxFileSize;
        this.update({ expires: d.expires, pairExpires: d.pairExpires });
        this.pair(d.guest);
      }
      if (!this.disposed) this.connect();
    } catch (e) {
      this.update({
        status: 'Connection failed',
        error: e instanceof Error ? e.message : 'Could not connect.',
      });
    }
  }
  private connect() {
    if (this.disposed || this.view.ended) return;
    const socket = new WebSocket(
      `${location.origin.replace(/^http/, 'ws')}/api/local/rooms/${this.room}/socket`,
    );
    this.socket = socket;
    socket.binaryType = 'arraybuffer';
    socket.onopen = () => {
      socket.send(
        JSON.stringify({
          type: 'auth',
          role: this.view.role,
          secret: this.secret,
        }),
      );
      this.lastBeat = Date.now();
      this.heartbeat = setInterval(() => {
        if (Date.now() - this.lastBeat > 45000) socket.close();
        else if (socket.readyState === WebSocket.OPEN)
          socket.send(JSON.stringify({ type: 'heartbeat' }));
      }, 15000);
    };
    socket.onmessage = (e) => {
      if (socket !== this.socket || this.disposed) return;
      try {
        if (e.data instanceof ArrayBuffer) {
          this.channel?.receive(e.data);
          return;
        }
        const m = localServerSchema.parse(JSON.parse(e.data));
        if (m.type === 'heartbeat') this.lastBeat = Date.now();
        else if (m.type === 'data')
          this.channel?.receive(JSON.stringify(m.payload));
        else if (m.type === 'ended')
          this.finish(m.reason === 'expired' ? 'The session expired.' : '');
        else if (m.type === 'pairing') {
          this.update({ pairExpires: m.pairExpires });
          this.pair(m.secret);
        } else if (m.type === 'peer-disconnected') {
          this.clearTransfer();
          this.options.clear();
          this.update({
            status: 'Disconnected',
            error: 'Device disconnected. Scan the new QR to pair again.',
          });
        } else if (m.type === 'connected') this.connected();
        else if (m.type === 'welcome') {
          this.attempts = 0;
          this.maxFileSize = m.maxFileSize;
          this.update({
            expires: m.expires,
            pairExpires: m.pairExpires,
            status: 'Waiting for device',
            error: '',
          });
          if (this.expiry) clearTimeout(this.expiry);
          this.expiry = setTimeout(
            () => this.finish('The session expired.'),
            Math.max(0, m.expires - Date.now()),
          );
          if (m.connected) this.connected();
        }
      } catch {
        this.update({
          status: 'Connection failed',
          error: 'Invalid response from the local server.',
        });
        socket.close(1008);
      }
    };
    socket.onerror = () =>
      this.update({
        error: 'Cannot reach the computer. Check Wi-Fi and Windows Firewall.',
      });
    socket.onclose = (e) => {
      if (socket !== this.socket) return;
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = null;
      this.clearTransfer();
      this.options.clear();
      if (this.disposed || this.view.ended) return;
      if (
        this.view.role === 'host' &&
        e.code !== 1008 &&
        ++this.attempts <= 3
      ) {
        this.update({ status: 'Reconnecting' });
        this.reconnect = setTimeout(() => this.connect(), 1000 * this.attempts);
      } else
        this.update({
          status: 'Connection failed',
          error:
            'This connection ended or the room is occupied. Scan a fresh QR.',
        });
    };
  }
  private connected() {
    this.clearTransfer();
    this.channel = new WebSocketChannel(this.socket!);
    this.transfer = new Transfer(
      this.channel,
      this.options.item,
      this.options.progress,
      this.options.error,
      { uuid: localUuid, digest: localDigest, maxFileSize: this.maxFileSize },
    );
    this.update({ status: 'Connected', error: '' });
  }
  private clearTransfer() {
    this.transfer?.dispose();
    this.transfer = null;
    this.channel?.dispose();
    this.channel = null;
  }
  rotate() {
    if (this.socket?.readyState === WebSocket.OPEN)
      this.socket.send(JSON.stringify({ type: 'rotate' }));
    else this.options.error('Reconnect before refreshing QR.');
  }
  clearError() {
    this.update({ error: '' });
  }
  retry() {
    if (this.view.role === 'guest') {
      this.options.error('Scan a fresh QR on your computer.');
      return;
    }
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.rotate();
      return;
    }
    if (!this.room) {
      void this.start();
      return;
    }
    this.stop();
    this.attempts = 0;
    this.connect();
  }
  async end() {
    if (this.view.role === 'host') {
      try {
        const r = await fetch(`/api/local/rooms/${this.room}/end`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.secret}` },
          keepalive: true,
          signal: AbortSignal.timeout(5000),
        });
        if (!r.ok && r.status !== 404) throw new Error();
      } catch {
        this.options.error(
          'Could not end the room. Check the server and try again.',
        );
        return;
      }
    }
    this.finish('');
  }
  private finish(error: string) {
    this.update({ ended: true, status: 'Session ended', pairUrl: '', error });
    this.options.clear();
    this.stop();
    this.secret = '';
  }
  private stop() {
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.reconnect) clearTimeout(this.reconnect);
    if (this.expiry) clearTimeout(this.expiry);
    this.clearTransfer();
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.onmessage = null;
      this.socket.onopen = null;
      this.socket.onerror = null;
      this.socket.close();
    }
    this.socket = null;
  }
  dispose() {
    this.disposed = true;
    this.stop();
    this.options.clear();
    this.secret = '';
    this.room = '';
  }
}
