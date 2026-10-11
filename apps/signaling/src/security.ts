import { secureToken } from '../../../packages/shared/protocol';
export { secureToken };
export async function hashSecret(secret: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(secret),
  );
  return [...new Uint8Array(bytes)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}
export async function matches(secret: string, hash: string): Promise<boolean> {
  const actual = await hashSecret(secret);
  let diff = actual.length ^ hash.length;
  for (let i = 0; i < actual.length; i++)
    diff |= actual.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}
export function lifetime(
  value: string | undefined,
  fallback: number,
  max: number,
): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1
    ? Math.min(n, max) * 1000
    : fallback * 1000;
}
export async function iceServers(env: {
  STUN_URLS?: string;
  TURN_URLS?: string;
  TURN_SECRET?: string;
}): Promise<RTCIceServer[]> {
  const servers: RTCIceServer[] = [];
  const stun = (env.STUN_URLS ?? '').split(',').filter(Boolean);
  if (stun.length) servers.push({ urls: stun });
  if (env.TURN_SECRET && env.TURN_URLS) {
    const username = `${Math.floor(Date.now() / 1000) + 3600}:${secureToken().slice(0, 12)}`;
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(env.TURN_SECRET),
      { name: 'HMAC', hash: 'SHA-1' },
      false,
      ['sign'],
    );
    const signature = await crypto.subtle.sign(
      'HMAC',
      key,
      new TextEncoder().encode(username),
    );
    servers.push({
      urls: env.TURN_URLS.split(','),
      username,
      credential: btoa(String.fromCharCode(...new Uint8Array(signature))),
    });
  }
  return servers;
}
