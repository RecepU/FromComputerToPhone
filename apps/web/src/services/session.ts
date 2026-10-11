import {
  joinCredentials,
  type Role,
  type Signal,
} from '../../../../packages/shared/protocol';
import { Transfer, type Item, type Progress } from './transfer';
export type Status =
  | 'Starting'
  | 'Waiting for device'
  | 'Connecting'
  | 'Connected'
  | 'Reconnecting'
  | 'Disconnected'
  | 'Connection failed'
  | 'Session ended';
export interface SessionView {
  status: Status;
  role: Role;
  pairUrl: string;
  pairExpires: number;
  expires: number;
  error: string;
  ended: boolean;
}
interface Options {
  view: (v: SessionView) => void;
  item: (i: Item) => void;
  progress: (p: Progress | null, id?: string) => void;
  clear: () => void;
  error: (s: string) => void;
}
const api =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ??
  '';
export class Session {
  private room = '';
  private secret = '';
  private guest = '';
  private socket: WebSocket | null = null;
  private peer: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  transfer: Transfer | null = null;
  private ice: RTCIceServer[] = [];
  private candidates: RTCIceCandidateInit[] = [];
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private deadline: ReturnType<typeof setTimeout> | null = null;
  private reconnect: ReturnType<typeof setTimeout> | null = null;
  private expiry: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private disposed = false;
  private generation = 0;
  private queue: Promise<void> = Promise.resolve();
  private lastBeat = Date.now();
  private view: SessionView = {
    status: 'Starting',
    role: 'host',
    pairUrl: '',
    pairExpires: 0,
    expires: 0,
    error: '',
    ended: false,
  };
  constructor(private options: Options) {}
  private update(change: Partial<SessionView>): void {
    if (this.disposed || (this.view.ended && !change.ended)) return;
    this.view = { ...this.view, ...change };
    if (!this.disposed) this.options.view(this.view);
  }
  async start(): Promise<void> {
    if (!window.RTCPeerConnection || !window.crypto?.subtle) {
      this.update({
        status: 'Connection failed',
        error:
          'This browser needs HTTPS and WebRTC support. Please use current Safari, Chrome or Edge.',
      });
      return;
    }
    try {
      if (location.pathname.startsWith('/join/')) {
        const credentials = joinCredentials(location.pathname, location.hash);
        if (!credentials)
          throw new Error('Invalid QR code. Scan a new QR on your computer.');
        this.room = credentials.room;
        this.secret = credentials.secret;
        history.replaceState(null, '', location.pathname);
        this.update({ role: 'guest' });
      } else {
        const response = await fetch(`${api}/api/rooms`, {
          method: 'POST',
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok)
          throw new Error(
            'Could not create a session. Please try again shortly.',
          );
        const data = (await response.json()) as {
          room: string;
          host: string;
          guest: string;
          expires: number;
          pairExpires: number;
          iceServers: RTCIceServer[];
        };
        if (this.disposed) return;
        this.room = data.room;
        this.secret = data.host;
        this.guest = data.guest;
        this.ice = data.iceServers;
        this.update({ expires: data.expires, pairExpires: data.pairExpires });
        this.pair();
      }
      if (!this.disposed) this.connectSocket();
    } catch (error) {
      this.update({
        status: 'Connection failed',
        error: error instanceof Error ? error.message : 'Could not connect.',
      });
    }
  }
  private pair(): void {
    this.update({
      pairUrl: `${location.origin}/join/${this.room}#${this.guest}`,
    });
  }
  private signal(message: Signal): void {
    if (this.socket?.readyState !== WebSocket.OPEN)
      throw new Error('Signaling disconnected.');
    this.socket.send(JSON.stringify(message));
  }
  private connectSocket(): void {
    const url = new URL(
      `${api || location.origin}/api/rooms/${this.room}/socket`,
    );
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(url);
    this.socket = socket;
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
        if (Date.now() - this.lastBeat > 45000) {
          socket.close();
          return;
        }
        if (socket.readyState === WebSocket.OPEN)
          socket.send(JSON.stringify({ type: 'heartbeat' }));
      }, 15000);
    };
    socket.onmessage = (e) => {
      this.queue = this.queue
        .then(() => this.handle(JSON.parse(e.data)))
        .catch((error) => {
          this.update({
            status: 'Connection failed',
            error:
              error instanceof Error
                ? error.message
                : 'Connection interrupted.',
          });
        });
    };
    socket.onerror = () =>
      this.update({
        error: 'Network disconnected or this session is unavailable.',
      });
    socket.onclose = (e) => {
      if (this.heartbeat) clearInterval(this.heartbeat);
      this.heartbeat = null;
      if (this.disposed || this.view.ended) return;
      this.closePeer();
      this.options.clear();
      if (e.code === 1008) {
        this.update({
          status: 'Connection failed',
          error:
            this.view.error ||
            'This QR is expired or the session is occupied. Scan a new QR.',
        });
        return;
      }
      if (++this.attempts <= 3) {
        this.update({ status: 'Reconnecting' });
        this.reconnect = setTimeout(
          () => this.connectSocket(),
          Math.min(this.attempts * 1000, 3000),
        );
      } else
        this.update({
          status: 'Connection failed',
          error: 'Connection lost. Try again or start a new session.',
        });
    };
  }
  private async handle(m: Record<string, unknown>): Promise<void> {
    if (this.disposed) return;
    if (m.type === 'heartbeat') {
      this.lastBeat = Date.now();
      return;
    }
    if (m.type === 'error') {
      this.update({ error: String(m.message), status: 'Connection failed' });
      return;
    }
    if (m.type === 'ended') {
      this.finish(
        m.reason === 'expired'
          ? 'The session expired after its maximum lifetime.'
          : '',
      );
      return;
    }
    if (m.type === 'pairing') {
      this.guest = String(m.secret);
      this.update({ pairExpires: Number(m.pairExpires) });
      this.pair();
      return;
    }
    if (m.type === 'welcome') {
      this.attempts = 0;
      this.update({
        expires: Number(m.expires),
        status: this.view.role === 'host' ? 'Waiting for device' : 'Connecting',
        error: '',
      });
      if (Array.isArray(m.iceServers))
        this.ice = m.iceServers as RTCIceServer[];
      if (this.expiry) clearTimeout(this.expiry);
      this.expiry = setTimeout(
        () => this.finish('The session expired after its maximum lifetime.'),
        Math.max(0, Number(m.expires) - Date.now()),
      );
      return;
    }
    if (m.type === 'peer-disconnected') {
      this.closePeer();
      this.update({
        status: 'Disconnected',
        error: 'Device disconnected. Scan the new QR to pair again.',
      });
      return;
    }
    if (m.type === 'peer-ready' || m.type === 'retry') {
      if (this.view.role === 'host') await this.offer();
      return;
    }
    if (m.type === 'offer') {
      await this.refreshIce();
      const peer = this.createPeer();
      await peer.setRemoteDescription({ type: 'offer', sdp: String(m.sdp) });
      await this.flushCandidates(peer);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      this.signal({ type: 'answer', sdp: answer.sdp! });
      return;
    }
    if (m.type === 'answer') {
      if (!this.peer) return;
      await this.peer.setRemoteDescription({
        type: 'answer',
        sdp: String(m.sdp),
      });
      await this.flushCandidates(this.peer);
      return;
    }
    if (m.type === 'ice') {
      const candidate = m.candidate as RTCIceCandidateInit;
      if (this.peer?.remoteDescription)
        await this.peer.addIceCandidate(candidate);
      else {
        if (this.candidates.length < 100) this.candidates.push(candidate);
      }
      return;
    }
  }
  private async flushCandidates(peer: RTCPeerConnection): Promise<void> {
    for (const c of this.candidates) await peer.addIceCandidate(c);
    this.candidates = [];
  }
  private createPeer(): RTCPeerConnection {
    if (this.disposed || this.view.ended) throw new Error('Session ended.');
    this.closePeer();
    const peer = new RTCPeerConnection({ iceServers: this.ice });
    this.peer = peer;
    this.update({ status: 'Connecting', error: '' });
    peer.onicecandidate = (e) => {
      if (e.candidate) {
        try {
          this.signal({
            type: 'ice',
            candidate: {
              ...e.candidate.toJSON(),
              candidate: e.candidate.candidate,
            },
          });
        } catch {
          /* WebSocket reconnection handles this. */
        }
      }
    };
    peer.ondatachannel = (e) => this.attach(e.channel);
    peer.onconnectionstatechange = () => {
      if (peer !== this.peer) return;
      if (['failed', 'disconnected'].includes(peer.connectionState))
        this.update({
          status: 'Connection failed',
          error:
            'Could not reach your device. Retry; restrictive networks may need a TURN relay.',
        });
    };
    this.deadline = setTimeout(() => {
      if (this.channel?.readyState !== 'open')
        this.update({
          status: 'Connection failed',
          error: 'Connection timed out. Retry or try another network.',
        });
    }, 20000);
    return peer;
  }
  private async offer(): Promise<void> {
    await this.refreshIce();
    const peer = this.createPeer();
    this.attach(peer.createDataChannel('transfer', { ordered: true }));
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    this.signal({ type: 'offer', sdp: offer.sdp! });
  }
  private async refreshIce(): Promise<void> {
    const response = await fetch(`${api}/api/rooms/${this.room}/ice`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.secret}` },
      signal: AbortSignal.timeout(10000),
    });
    if (response.status === 404) {
      this.finish('');
      throw new Error('Session ended.');
    }
    if (!response.ok)
      throw new Error('Could not prepare the connection. Please retry.');
    const data = (await response.json()) as { iceServers: RTCIceServer[] };
    this.ice = data.iceServers;
  }
  private attach(channel: RTCDataChannel): void {
    this.channel = channel;
    const generation = this.generation;
    channel.onopen = () => {
      if (this.disposed || generation !== this.generation) {
        channel.close();
        return;
      }
      if (this.deadline) clearTimeout(this.deadline);
      this.transfer = new Transfer(
        channel,
        this.options.item,
        this.options.progress,
        this.options.error,
      );
      this.update({ status: 'Connected', error: '' });
    };
    channel.onclose = () => {
      if (
        !this.disposed &&
        !this.view.ended &&
        generation === this.generation
      ) {
        this.transfer?.dispose();
        this.transfer = null;
        this.update({ status: 'Disconnected' });
      }
    };
    channel.onerror = () =>
      this.options.error('Transfer connection interrupted.');
  }
  retry(): void {
    void (async () => {
      try {
        this.update({ error: '' });
        if (!this.room) {
          this.update({ status: 'Starting' });
          await this.start();
          return;
        }
        if (this.socket?.readyState !== WebSocket.OPEN) {
          this.attempts = 0;
          if (this.socket) this.socket.onclose = null;
          this.socket?.close();
          if (this.heartbeat) clearInterval(this.heartbeat);
          if (this.reconnect) clearTimeout(this.reconnect);
          this.connectSocket();
        } else if (this.view.role === 'host') await this.offer();
        else this.signal({ type: 'retry' });
      } catch {
        this.update({
          status: 'Connection failed',
          error: 'Retry failed. Please scan a new QR.',
        });
      }
    })();
  }
  rotate(): void {
    try {
      this.signal({ type: 'rotate' });
    } catch {
      this.options.error('Reconnect before refreshing the QR.');
    }
  }
  clearError(): void {
    this.update({ error: '' });
  }
  async end(): Promise<void> {
    if (this.view.role === 'guest') {
      this.finish('');
      return;
    }
    try {
      const response = await fetch(`${api}/api/rooms/${this.room}/end`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.secret}` },
        keepalive: true,
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok && response.status !== 404) throw new Error();
      this.finish('');
    } catch {
      this.options.error(
        'Could not end the session. Check your connection and try again.',
      );
    }
  }
  private closePeer(): void {
    this.generation++;
    if (this.deadline) clearTimeout(this.deadline);
    this.deadline = null;
    this.transfer?.dispose();
    this.transfer = null;
    if (this.channel) {
      this.channel.onopen = null;
      this.channel.onclose = null;
      this.channel.onerror = null;
      this.channel.close();
    }
    this.channel = null;
    if (this.peer) {
      this.peer.onicecandidate = null;
      this.peer.onconnectionstatechange = null;
      this.peer.ondatachannel = null;
      this.peer.close();
    }
    this.peer = null;
    this.candidates = [];
  }
  private finish(error: string): void {
    this.update({ ended: true, status: 'Session ended', error, pairUrl: '' });
    this.options.clear();
    this.stop();
    this.secret = '';
    this.guest = '';
  }
  private stop(): void {
    if (this.expiry) clearTimeout(this.expiry);
    if (this.heartbeat) clearInterval(this.heartbeat);
    if (this.reconnect) clearTimeout(this.reconnect);
    this.closePeer();
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.onmessage = null;
      this.socket.onopen = null;
      this.socket.onerror = null;
      this.socket.close();
    }
    this.socket = null;
  }
  dispose(): void {
    this.disposed = true;
    this.stop();
    this.options.clear();
    this.secret = '';
    this.guest = '';
    this.room = '';
    this.ice = [];
  }
}
