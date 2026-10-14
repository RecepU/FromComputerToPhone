import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/local',
  timeout: 60000,
  workers: 1,
  use: {
    baseURL: 'http://127.0.0.1:3000',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: [
    {
      command: 'npm run build:local && npm run start:local',
      url: 'http://127.0.0.1:3000',
      reuseExistingServer: false,
      timeout: 120000,
      env: { LAN_IP: '127.0.0.1', PORT: '3000' },
    },
    {
      command: 'npm run start:local',
      url: 'http://127.0.0.1:3001',
      reuseExistingServer: false,
      timeout: 120000,
      env: { PORT: '3001' },
    },
  ],
});
