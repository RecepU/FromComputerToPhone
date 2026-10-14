import { defineConfig, loadEnv } from 'vite';
import { readFileSync, writeFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
export default defineConfig(({ mode }) => {
  const local =
    mode !== 'cloud' &&
    (mode === 'lan' || process.env.VITE_APP_MODE !== 'cloud');
  const env = loadEnv(mode, 'apps/web', 'VITE_');
  const endpoint = env.VITE_API_URL || process.env.VITE_API_URL || '';
  const base = local
    ? '/'
    : process.env.VITE_BASE_PATH || env.VITE_BASE_PATH || '/';
  if (!/^\/(?:[A-Za-z0-9_-]+\/)*$/.test(base))
    throw new Error(
      'VITE_BASE_PATH must be an absolute directory path ending in /.',
    );
  const pages = !local && base !== '/';
  function securityHeaders() {
    let connections = "'self'";
    if (endpoint) {
      const url = new URL(endpoint);
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.search ||
        url.hash
      )
        throw new Error(
          'Production VITE_API_URL must be a plain HTTPS endpoint.',
        );
      connections += ` ${url.origin} wss://${url.host}`;
    }
    return readFileSync('apps/web/public/_headers', 'utf8').replace(
      "connect-src 'self'",
      `connect-src ${connections}`,
    );
  }
  return {
    root: 'apps/web',
    base,
    define: {
      'import.meta.env.VITE_APP_MODE': JSON.stringify(
        local ? 'local' : 'cloud',
      ),
    },
    plugins: [
      react(),
      tailwind(),
      {
        name: 'production-security-headers',
        transformIndexHtml(html) {
          if (!pages || !endpoint) return html;
          const csp = securityHeaders()
            .split('\n')
            .find((line) => line.includes('Content-Security-Policy:'))!
            .split('Content-Security-Policy:')[1]
            .trim()
            .replace(/; frame-ancestors[^;]*/, '');
          return {
            html,
            tags: [
              {
                tag: 'meta',
                attrs: {
                  'http-equiv': 'Content-Security-Policy',
                  content: csp,
                },
                injectTo: 'head-prepend',
              },
            ],
          };
        },
        closeBundle() {
          if (local) return;
          const headers = securityHeaders();
          writeFileSync('apps/web/dist/_headers', headers);
          if (pages) {
            writeFileSync(
              'apps/web/dist/404.html',
              readFileSync('apps/web/dist/index.html'),
            );
            writeFileSync('apps/web/dist/.nojekyll', '');
          }
        },
      },
    ],
    server: {
      port: 5173,
      strictPort: true,
      proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } },
    },
    build: { outDir: local ? 'dist-local' : 'dist', emptyOutDir: true },
  };
});
