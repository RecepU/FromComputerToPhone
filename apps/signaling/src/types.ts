import type { Role } from '../../../packages/shared/protocol';
export interface Env {
  ROOMS: DurableObjectNamespace;
  LIMITER: DurableObjectNamespace;
  ALLOWED_ORIGINS: string;
  SESSION_TTL_SECONDS?: string;
  HOST_GRACE_SECONDS?: string;
  STUN_URLS?: string;
  TURN_URLS?: string;
  TURN_SECRET?: string;
}
export interface Metadata {
  hostHash: string;
  guestHash: string;
  expires: number;
  pairExpires: number;
  hostGone: number | null;
}
export interface SocketInfo {
  role?: Role;
  since: number;
  lastSeen: number;
  window: number;
  count: number;
}
