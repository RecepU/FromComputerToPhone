import { z } from 'zod';
import { authSchema, dataSchema, tokenSchema } from './protocol';
export const localClientSchema = z.union([
  authSchema,
  z.object({ type: z.literal('heartbeat') }).strict(),
  z.object({ type: z.literal('rotate') }).strict(),
  z.object({ type: z.literal('data'), payload: dataSchema }).strict(),
]);
export const localServerSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('welcome'),
      expires: z.number(),
      pairExpires: z.number(),
      maxFileSize: z.number(),
      connected: z.boolean(),
    })
    .strict(),
  z.object({ type: z.literal('connected') }).strict(),
  z.object({ type: z.literal('heartbeat') }).strict(),
  z
    .object({
      type: z.literal('pairing'),
      secret: tokenSchema,
      pairExpires: z.number(),
    })
    .strict(),
  z.object({ type: z.literal('peer-disconnected') }).strict(),
  z
    .object({
      type: z.literal('ended'),
      reason: z.enum([
        'ended',
        'expired',
        'host-disconnected',
        'server-stopped',
      ]),
    })
    .strict(),
  z.object({ type: z.literal('data'), payload: dataSchema }).strict(),
]);
export const localRoomSchema = z
  .object({
    room: tokenSchema,
    host: tokenSchema,
    guest: tokenSchema,
    expires: z.number(),
    pairExpires: z.number(),
    pairOrigin: z.string().url(),
    maxFileSize: z.number(),
  })
  .strict();
