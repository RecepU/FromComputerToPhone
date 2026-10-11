import { DurableObject } from 'cloudflare:workers';
import { secureToken, tokenSchema } from '../../../packages/shared/protocol';
import type { Env } from './types';
import { iceServers } from './security';
export { Room } from './room';
export class Limiter extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const now = Date.now();
      const entry = await this.ctx.storage.get<{
        until: number;
        count: number;
      }>('limit');
      const current =
        entry && entry.until > now ? entry : { until: now + 60000, count: 0 };
      current.count++;
      await this.ctx.storage.put('limit', current);
      await this.ctx.storage.setAlarm(current.until);
      return new Response(null, {
        status:
          current.count >
          (new URL(request.url).pathname === '/create' ? 30 : 120)
            ? 429
            : 204,
      });
    });
  }
  async alarm(): Promise<void> {
    await this.ctx.storage.deleteAll();
  }
}
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url),
      origin = request.headers.get('Origin');
    const allowed = env.ALLOWED_ORIGINS.split(',').map((v) => v.trim());
    const headers = {
      'Access-Control-Allow-Origin': origin ?? '',
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      Vary: 'Origin',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    };
    const error = (status: number, message: string) =>
      Response.json({ error: message }, { status, headers });
    if (!origin || !allowed.includes(origin))
      return error(403, 'Origin not allowed');
    if (
      url.protocol !== 'https:' &&
      !['localhost', '127.0.0.1'].includes(url.hostname)
    )
      return error(400, 'HTTPS required');
    if (request.method === 'OPTIONS')
      return new Response(null, { status: 204, headers });
    if (request.method === 'POST' && request.body) {
      if (Number(request.headers.get('Content-Length') ?? 0) > 0)
        return error(413, 'Request body not allowed');
      const reader = request.body.getReader();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const first = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) => {
            timer = setTimeout(() => reject(new Error('Body timeout')), 2000);
          }),
        ]);
        if (!first.done) return error(413, 'Request body not allowed');
      } catch {
        return error(413, 'Request body not allowed');
      } finally {
        if (timer !== undefined) clearTimeout(timer);
        await reader.cancel().catch(() => {});
      }
    }
    try {
      const ip = request.headers.get('CF-Connecting-IP') ?? 'local';
      const bucket = url.pathname === '/api/rooms' ? 'create' : 'access';
      const limit = await env.LIMITER.get(
        env.LIMITER.idFromName(`${bucket}:${ip}`),
      ).fetch(`https://internal/${bucket}`);
      if (limit.status === 429)
        return error(429, 'Too many requests. Please wait a minute.');
      if (url.pathname === '/api/rooms' && request.method === 'POST') {
        const room = secureToken();
        const response = await env.ROOMS.get(env.ROOMS.idFromName(room)).fetch(
          'https://internal/create',
        );
        const data = (await response.json()) as Record<string, unknown>;
        return Response.json(
          { ...data, room, iceServers: await iceServers(env) },
          { headers },
        );
      }
      const match = /^\/api\/rooms\/([^/]+)\/(socket|end|ice)$/.exec(
        url.pathname,
      );
      if (!match || !tokenSchema.safeParse(match[1]).success)
        return error(404, 'Session unavailable');
      const target = env.ROOMS.get(env.ROOMS.idFromName(match[1]));
      if (
        match[2] === 'socket' &&
        request.method === 'GET' &&
        request.headers.get('Upgrade')?.toLowerCase() === 'websocket'
      )
        return target.fetch(
          new Request('https://internal/socket', {
            method: 'GET',
            headers: request.headers,
          }),
        );
      if (['end', 'ice'].includes(match[2]) && request.method === 'POST') {
        const response = await target.fetch(
          new Request(`https://internal/${match[2]}`, {
            method: 'POST',
            headers: request.headers,
          }),
        );
        return new Response(response.body, {
          status: response.status,
          headers,
        });
      }
      return error(404, 'Session unavailable');
    } catch {
      return error(503, 'Service unavailable. Please try again.');
    }
  },
} satisfies ExportedHandler<Env>;
