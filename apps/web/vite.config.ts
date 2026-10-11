import { defineConfig, loadEnv } from 'vite';
import { readFileSync, writeFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, 'apps/web', 'VITE_');
  const endpoint = env.VITE_API_URL || process.env.VITE_API_URL || '';
  return {
    root: 'apps/web',
    plugins: [
      react(),
      tailwind(),
      {
        name: 'production-security-headers',
        closeBundle() {
          let connections = "'self'";
          if (endpoint) {
            const url = new URL(endpoint);
            if (url.protocol !== 'https:')
              throw new Error('Production VITE_API_URL must use HTTPS.');
            connections += ` ${url.origin} wss://${url.host}`;
          }
          const headers = readFileSync(
            'apps/web/public/_headers',
            'utf8',
          ).replace("connect-src 'self'", `connect-src ${connections}`);
          writeFileSync('apps/web/dist/_headers', headers);
        },
      },
    ],
    server: {
      port: 5173,
      strictPort: true,
      proxy: { '/api': { target: 'http://127.0.0.1:8787', ws: true } },
    },
    build: { outDir: 'dist', emptyOutDir: true },
  };
});
