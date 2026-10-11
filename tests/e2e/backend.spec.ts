import { test, expect } from '@playwright/test';
import WebSocket from 'ws';
import { secureToken } from '../../packages/shared/protocol';
const origin = 'http://127.0.0.1:5173';
interface Created {
  room: string;
  host: string;
  guest: string;
  expires: number;
}
async function create(port = 8787): Promise<Created> {
  const response = await fetch(`http://127.0.0.1:${port}/api/rooms`, {
    method: 'POST',
    headers: { Origin: origin },
  });
  expect(response.status).toBe(200);
  return response.json() as Promise<Created>;
}
class Device {
  socket: WebSocket;
  messages: Record<string, unknown>[] = [];
  closed = false;
  constructor(room: string, port = 8787) {
    this.socket = new WebSocket(
      `ws://127.0.0.1:${port}/api/rooms/${room}/socket`,
      { origin },
    );
    this.socket.on('message', (raw) =>
      this.messages.push(JSON.parse(raw.toString()) as Record<string, unknown>),
    );
    this.socket.on('close', () => (this.closed = true));
    this.socket.on('error', () => {});
  }
  async auth(role: 'host' | 'guest', secret: string) {
    await new Promise<void>((resolve, reject) => {
      this.socket.once('open', resolve);
      this.socket.once('error', reject);
    });
    this.send({ type: 'auth', role, secret });
  }
  send(message: unknown) {
    this.socket.send(JSON.stringify(message));
  }
  async message(type: string) {
    await expect
      .poll(() => this.messages.find((m) => m.type === type), {
        timeout: 10000,
      })
      .toBeTruthy();
    return this.messages.splice(
      this.messages.findIndex((m) => m.type === type),
      1,
    )[0];
  }
  close() {
    this.socket.close();
  }
}
test('real Durable Object: capabilities, occupancy, signaling and guest rotation', async () => {
  const room = await create();
  const host = new Device(room.room);
  await host.auth('host', room.host);
  await host.message('welcome');
  const iceBeforePairing = await fetch(
    `http://127.0.0.1:8787/api/rooms/${room.room}/ice`,
    {
      method: 'POST',
      headers: { Origin: origin, Authorization: `Bearer ${room.guest}` },
    },
  );
  expect(iceBeforePairing.status).toBe(403);
  const imposter = new Device(room.room);
  await imposter.auth('host', room.guest);
  await imposter.message('error');
  expect(imposter.messages.some((m) => m.type === 'welcome')).toBe(false);
  imposter.close();
  const guest = new Device(room.room);
  await guest.auth('guest', room.guest);
  await guest.message('welcome');
  const iceAfterPairing = await fetch(
    `http://127.0.0.1:8787/api/rooms/${room.room}/ice`,
    {
      method: 'POST',
      headers: { Origin: origin, Authorization: `Bearer ${room.guest}` },
    },
  );
  expect(iceAfterPairing.status).toBe(200);
  await host.message('peer-ready');
  const third = new Device(room.room);
  await third.auth('guest', room.guest);
  await third.message('error');
  third.close();
  host.send({ type: 'offer', sdp: 'offer-for-test' });
  expect((await guest.message('offer')).sdp).toBe('offer-for-test');
  guest.send({ type: 'answer', sdp: 'answer-for-test' });
  expect((await host.message('answer')).sdp).toBe('answer-for-test');
  guest.send({ type: 'ice', candidate: { candidate: 'candidate-test' } });
  expect((await host.message('ice')).candidate).toEqual({
    candidate: 'candidate-test',
  });
  const forbiddenEnd = await fetch(
    `http://127.0.0.1:8787/api/rooms/${room.room}/end`,
    {
      method: 'POST',
      headers: { Origin: origin, Authorization: `Bearer ${room.guest}` },
    },
  );
  expect(forbiddenEnd.status).toBe(403);
  guest.close();
  await host.message('peer-disconnected');
  const rotated = await host.message('pairing');
  expect(rotated.secret).not.toBe(room.guest);
  const replay = new Device(room.room);
  await replay.auth('guest', room.guest);
  await replay.message('error');
  replay.close();
  const replacement = new Device(room.room);
  await replacement.auth('guest', String(rotated.secret));
  await replacement.message('welcome');
  await host.message('peer-ready');
  host.send({ type: 'end' });
  await replacement.message('ended');
  await expect.poll(() => host.closed).toBe(true);
  replacement.close();
  const old = await fetch(`http://127.0.0.1:8787/api/rooms/${room.room}/end`, {
    method: 'POST',
    headers: { Origin: origin, Authorization: `Bearer ${room.host}` },
  });
  expect(old.status).toBe(404);
});
test('invalid schemas are rejected without injecting signaling', async () => {
  const room = await create();
  const host = new Device(room.room);
  await host.auth('host', room.host);
  await host.message('welcome');
  host.send({ type: 'offer', sdp: 'test', extra: true });
  await expect.poll(() => host.closed).toBe(true);
});
test('host network drop permits brief reconnect then revokes the room', async () => {
  const room = await create();
  const host = new Device(room.room);
  await host.auth('host', room.host);
  await host.message('welcome');
  host.close();
  await expect.poll(() => host.closed).toBe(true);
  const recovered = new Device(room.room);
  await recovered.auth('host', room.host);
  await recovered.message('welcome');
  const guest = new Device(room.room);
  await guest.auth('guest', room.guest);
  await guest.message('welcome');
  recovered.close();
  await guest.message('ended');
  guest.close();
  const response = await fetch(
    `http://127.0.0.1:8787/api/rooms/${room.room}/end`,
    {
      method: 'POST',
      headers: { Origin: origin, Authorization: `Bearer ${room.host}` },
    },
  );
  expect(response.status).toBe(404);
});
test('backend lifetime expires independently of live sockets and heartbeats', async () => {
  const room = await create(8788);
  const host = new Device(room.room, 8788);
  await host.auth('host', room.host);
  await host.message('welcome');
  const guest = new Device(room.room, 8788);
  await guest.auth('guest', room.guest);
  await guest.message('welcome');
  const heartbeats = setInterval(() => {
    if (host.socket.readyState === WebSocket.OPEN)
      host.send({ type: 'heartbeat' });
  }, 200);
  try {
    expect((await guest.message('ended')).reason).toBe('expired');
  } finally {
    clearInterval(heartbeats);
    host.close();
    guest.close();
  }
  const response = await fetch(
    `http://127.0.0.1:8788/api/rooms/${room.room}/end`,
    {
      method: 'POST',
      headers: { Origin: origin, Authorization: `Bearer ${room.host}` },
    },
  );
  expect(response.status).toBe(404);
});
test('origin and room identifiers are validated', async () => {
  const payload = await fetch('http://127.0.0.1:8787/api/rooms', {
    method: 'POST',
    headers: { Origin: origin },
    body: 'not-allowed',
  });
  expect(payload.status).toBe(413);
  const response = await fetch('http://127.0.0.1:8787/api/rooms', {
    method: 'POST',
    headers: { Origin: 'https://evil.example' },
  });
  expect(response.status).toBe(403);
  const invalid = await fetch('http://127.0.0.1:8787/api/rooms/guess/end', {
    method: 'POST',
    headers: { Origin: origin },
  });
  expect(invalid.status).toBe(404);
  const absent = await fetch(
    `http://127.0.0.1:8787/api/rooms/${secureToken()}/end`,
    { method: 'POST', headers: { Origin: origin } },
  );
  expect(absent.status).toBe(404);
});
