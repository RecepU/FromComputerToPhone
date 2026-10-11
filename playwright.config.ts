import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60000,
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: [
    {
      command:
        'npx wrangler dev --config apps/signaling/wrangler.jsonc --port 8787 --persist-to .wrangler/e2e --var HOST_GRACE_SECONDS:2',
      url: 'http://127.0.0.1:8787',
      reuseExistingServer: false,
      timeout: 120000,
    },
    {
      command:
        'npx wrangler dev --config apps/signaling/wrangler.jsonc --port 8788 --persist-to .wrangler/expiry --var SESSION_TTL_SECONDS:3 --var HOST_GRACE_SECONDS:2',
      url: 'http://127.0.0.1:8788',
      reuseExistingServer: false,
      timeout: 120000,
    },
    {
      command: 'npm run dev:web',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
  ],
});
