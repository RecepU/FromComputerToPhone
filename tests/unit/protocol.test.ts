import { describe, it, expect } from 'vitest';
import {
  dataSchema,
  digest,
  joinCredentials,
  MAX_FILE_SIZE,
  safeUrl,
  secureToken,
  signalSchema,
  tokenSchema,
  validImageSignature,
  safeImageName,
} from '../../packages/shared/protocol';
import {
  hashSecret,
  lifetime,
  matches,
  iceServers,
} from '../../apps/signaling/src/security';
describe('capabilities', () => {
  it('uses 256 bits of randomness and independent tokens', () => {
    const values = new Set(Array.from({ length: 500 }, secureToken));
    expect(values.size).toBe(500);
    for (const value of values)
      expect(tokenSchema.safeParse(value).success).toBe(true);
  });
  it('validates guest pairing URLs strictly', () => {
    const room = secureToken(),
      secret = secureToken();
    expect(joinCredentials(`/join/${room}`, `#${secret}`)).toEqual({
      room,
      secret,
    });
    expect(joinCredentials(`/join/${room}/extra`, `#${secret}`)).toBeNull();
    expect(joinCredentials(`/join/${room}`, '#bad')).toBeNull();
  });
  it('verifies hashes without granting another capability', async () => {
    const host = secureToken(),
      guest = secureToken(),
      hash = await hashSecret(host);
    expect(await matches(host, hash)).toBe(true);
    expect(await matches(guest, hash)).toBe(false);
    expect(hash).not.toContain(host);
  });
  it('caps lifetime at 24 hours regardless of environment', () => {
    expect(lifetime('999999', 86400, 86400)).toBe(86400000);
    expect(lifetime(undefined, 86400, 86400)).toBe(86400000);
    expect(lifetime('2', 15, 60)).toBe(2000);
  });
  it('issues short-lived TURN credentials only when configured', async () => {
    expect(await iceServers({})).toEqual([]);
    const servers = await iceServers({
      TURN_SECRET: 'test-only',
      TURN_URLS: 'turn:example.com:3478',
    });
    expect(servers[0].credential).toMatch(/^[\w+/]+=*$/);
    expect(Number(servers[0].username?.split(':')[0])).toBeGreaterThan(
      Date.now() / 1000 + 3500,
    );
  });
});
describe('untrusted inputs', () => {
  it('keeps image downloads in a safe filename and extension', () => {
    expect(safeImageName('photo.jpeg', 'image/jpeg')).toBe('photo.jpeg');
    expect(safeImageName('../../evil.html', 'image/png')).toBe('evil.html.png');
    expect(safeImageName('bad\u0000:name', 'image/gif')).toBe('bad__name.gif');
  });
  it('allows only HTTP and HTTPS links', () => {
    expect(safeUrl('https://example.com')).toBe('https://example.com/');
    for (const value of [
      'javascript:alert(1)',
      'data:text/html,test',
      'file:///tmp/a',
      'invalid',
    ])
      expect(safeUrl(value)).toBeNull();
  });
  it('rejects extra fields and oversized signaling', () => {
    expect(signalSchema.safeParse({ type: 'end', role: 'host' }).success).toBe(
      false,
    );
    expect(
      signalSchema.safeParse({ type: 'offer', sdp: 'x'.repeat(24001) }).success,
    ).toBe(false);
  });
  it('enforces file MIME, size, hash and text limits', () => {
    const file = {
      type: 'file',
      id: crypto.randomUUID(),
      name: 'image.png',
      mime: 'image/png',
      size: MAX_FILE_SIZE,
      sha256: 'a'.repeat(64),
    };
    expect(dataSchema.safeParse(file).success).toBe(true);
    expect(
      dataSchema.safeParse({ ...file, size: MAX_FILE_SIZE + 1 }).success,
    ).toBe(false);
    expect(
      dataSchema.safeParse({ ...file, mime: 'image/svg+xml' }).success,
    ).toBe(false);
    expect(
      dataSchema.safeParse({
        type: 'text',
        id: crypto.randomUUID(),
        text: '😀'.repeat(17000),
        timestamp: 1,
      }).success,
    ).toBe(false);
  });
  it('verifies image signatures and SHA-256', async () => {
    expect(
      validImageSignature(
        new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
        'image/png',
      ),
    ).toBe(true);
    expect(
      validImageSignature(new TextEncoder().encode('<script>'), 'image/png'),
    ).toBe(false);
    expect(await digest(new TextEncoder().encode('abc').buffer)).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });
});
