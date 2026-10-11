// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { webcrypto } from 'node:crypto';
import { Session, type SessionView } from '../../apps/web/src/services/session';
import { secureToken } from '../../packages/shared/protocol';
class Socket {
  static OPEN = 1;
  static instances: Socket[] = [];
  readyState = 1;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(public url: string) {
    Socket.instances.push(this);
    queueMicrotask(() => this.onopen?.());
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  message(message: unknown) {
    this.onmessage?.({ data: JSON.stringify(message) });
  }
  remoteClose(code: number) {
    this.readyState = 3;
    this.onclose?.({ code } as CloseEvent);
  }
}
const sessions: Session[] = [];
function make() {
  const views: SessionView[] = [];
  const clear = vi.fn();
  const session = new Session({
    view: (v) => views.push(v),
    clear,
    error: vi.fn(),
    item: vi.fn(),
    progress: vi.fn(),
  });
  sessions.push(session);
  return { session, views, clear };
}
beforeEach(() => {
  vi.useFakeTimers();
  Socket.instances = [];
  history.replaceState(null, '', '/');
  vi.spyOn(window, 'crypto', 'get').mockReturnValue(
    webcrypto as unknown as Crypto,
  );
  vi.stubGlobal('RTCPeerConnection', class {});
  vi.stubGlobal('WebSocket', Socket);
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          room: secureToken(),
          host: secureToken(),
          guest: secureToken(),
          expires: Date.now() + 86400000,
          pairExpires: Date.now() + 600000,
          iceServers: [],
        }),
      ),
    ),
  );
});
afterEach(() => {
  for (const s of sessions.splice(0)) s.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  history.replaceState(null, '', '/');
});
describe('session states and cleanup', () => {
  it('starts a host with separate pairing credentials and waits for authentication', async () => {
    const p = make();
    await p.session.start();
    await vi.advanceTimersByTimeAsync(0);
    const socket = Socket.instances[0];
    const auth = JSON.parse(socket.sent[0]);
    expect(auth.role).toBe('host');
    expect(p.views.at(-1)?.pairUrl).not.toContain(auth.secret);
    expect(socket.url).not.toContain(auth.secret);
    socket.message({
      type: 'welcome',
      expires: Date.now() + 86400000,
      iceServers: [],
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(p.views.at(-1)?.status).toBe('Waiting for device');
    socket.message({ type: 'ended', reason: 'ended' });
    await vi.advanceTimersByTimeAsync(0);
    expect(p.views.at(-1)?.ended).toBe(true);
    expect(p.views.at(-1)?.pairUrl).toBe('');
    expect(p.clear).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('uses a guest role and strips the secret from browser history', async () => {
    const room = secureToken(),
      secret = secureToken();
    history.replaceState(null, '', `/join/${room}#${secret}`);
    const p = make();
    await p.session.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(location.hash).toBe('');
    expect(JSON.parse(Socket.instances[0].sent[0])).toEqual({
      type: 'auth',
      role: 'guest',
      secret,
    });
    expect(fetch).not.toHaveBeenCalled();
    Socket.instances[0].message({
      type: 'error',
      message: 'Invalid or expired pairing credentials.',
    });
    await vi.advanceTimersByTimeAsync(0);
    Socket.instances[0].remoteClose(1008);
    expect(p.views.at(-1)?.status).toBe('Connection failed');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('clears an offline page at the absolute server deadline', async () => {
    const p = make();
    await p.session.start();
    await vi.advanceTimersByTimeAsync(0);
    Socket.instances[0].message({
      type: 'welcome',
      expires: Date.now() + 1000,
      iceServers: [],
    });
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1001);
    expect(p.views.at(-1)?.status).toBe('Session ended');
    expect(p.clear).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('bounds automatic reconnection attempts and clears local content', async () => {
    const p = make();
    await p.session.start();
    await vi.advanceTimersByTimeAsync(0);
    for (const delay of [1000, 2000, 3000]) {
      Socket.instances.at(-1)!.remoteClose(1006);
      expect(p.views.at(-1)?.status).toBe('Reconnecting');
      await vi.advanceTimersByTimeAsync(delay);
    }
    Socket.instances.at(-1)!.remoteClose(1006);
    expect(Socket.instances).toHaveLength(4);
    expect(p.views.at(-1)?.status).toBe('Connection failed');
    expect(vi.getTimerCount()).toBe(0);
    expect(p.clear).toHaveBeenCalledTimes(4);
  });
});
