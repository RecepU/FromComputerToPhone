import { z } from 'zod';
export const MAX_FILE_SIZE = 10 * 1024 * 1024;
export const CHUNK_SIZE = 16 * 1024 - 40;
export const MAX_TEXT_BYTES = 64 * 1024;
export const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const idSchema = z.string().uuid();
export const imageMime = z.enum([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]);
export function safeImageName(original: string, mime: string): string {
  const leaf = (original.split(/[\\/]/).pop() ?? 'image').replace(
    /[<>:"|?*]/g,
    '_',
  );
  const name =
    Array.from(leaf, (c) => (c.charCodeAt(0) < 32 ? '_' : c))
      .join('')
      .replace(/\.+$/, '')
      .slice(0, 160) || 'image';
  const extensions: Record<string, string[]> = {
    'image/png': ['png'],
    'image/jpeg': ['jpg', 'jpeg'],
    'image/webp': ['webp'],
    'image/gif': ['gif'],
  };
  const allowed = Object.hasOwn(extensions, mime) ? extensions[mime] : ['png'];
  return allowed.includes(name.split('.').pop()?.toLowerCase() ?? '')
    ? name
    : `${name}.${allowed[0]}`;
}
export const authSchema = z
  .object({
    type: z.literal('auth'),
    role: z.enum(['host', 'guest']),
    secret: tokenSchema,
  })
  .strict();
export const signalSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('offer'), sdp: z.string().max(24000) }).strict(),
  z.object({ type: z.literal('answer'), sdp: z.string().max(24000) }).strict(),
  z
    .object({
      type: z.literal('ice'),
      candidate: z
        .object({
          candidate: z.string().max(2048),
          sdpMid: z.string().max(32).nullable().optional(),
          sdpMLineIndex: z.number().int().min(0).max(32).nullable().optional(),
          usernameFragment: z.string().max(256).nullable().optional(),
        })
        .strict(),
    })
    .strict(),
  z.object({ type: z.literal('retry') }).strict(),
  z.object({ type: z.literal('heartbeat') }).strict(),
  z.object({ type: z.literal('rotate') }).strict(),
  z.object({ type: z.literal('end') }).strict(),
]);
export type Signal = z.infer<typeof signalSchema>;
export const dataSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('text'),
      id: idSchema,
      text: z
        .string()
        .min(1)
        .refine((v) => new TextEncoder().encode(v).length <= MAX_TEXT_BYTES),
      timestamp: z.number().finite(),
    })
    .strict(),
  z
    .object({
      type: z.literal('file'),
      id: idSchema,
      name: z.string().min(1).max(200),
      mime: imageMime,
      size: z.number().int().positive().max(MAX_FILE_SIZE),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .strict(),
  z.object({ type: z.literal('complete'), id: idSchema }).strict(),
  z.object({ type: z.literal('ack'), id: idSchema }).strict(),
  z.object({ type: z.literal('cancel'), id: idSchema }).strict(),
]);
export type DataMessage = z.infer<typeof dataSchema>;
export type Role = 'host' | 'guest';
export function secureToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
export async function digest(data: ArrayBuffer): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', data)))
    .map((v) => v.toString(16).padStart(2, '0'))
    .join('');
}
export function safeUrl(value: string): string | null {
  try {
    const u = new URL(value);
    return ['https:', 'http:'].includes(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}
export function joinCredentials(
  path: string,
  hash: string,
): { room: string; secret: string } | null {
  const match = /^\/join\/([A-Za-z0-9_-]{43})\/?$/.exec(path);
  const secret = hash.slice(1);
  return match && tokenSchema.safeParse(secret).success
    ? { room: match[1], secret }
    : null;
}
export function validImageSignature(bytes: Uint8Array, mime: string): boolean {
  if (mime === 'image/png')
    return [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v);
  if (mime === 'image/jpeg')
    return bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const ascii = (start: number, end: number) =>
    String.fromCharCode(...bytes.slice(start, end));
  if (mime === 'image/gif') return ['GIF87a', 'GIF89a'].includes(ascii(0, 6));
  return (
    mime === 'image/webp' && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP'
  );
}
