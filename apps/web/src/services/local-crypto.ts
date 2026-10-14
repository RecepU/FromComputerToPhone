import { sha256 } from '@noble/hashes/sha256';
// getRandomValues works on HTTP; randomUUID and subtle need a secure context.
export function localUuid(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export async function localDigest(data: ArrayBuffer): Promise<string> {
  return Array.from(sha256(new Uint8Array(data)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
