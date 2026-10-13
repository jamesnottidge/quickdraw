import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  workers: 1,
  fullyParallel: false,
  use: { baseURL: 'http://localhost:3100', trace: 'retain-on-failure' },
  webServer: {
    command: 'npx next dev --port 3100',
    url: 'http://localhost:3100',
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      FAKE_MODELS: '1',
      FAKE_DELAY_MS: '40',
      IP_HASH_SALT: 'e2e',
      RUNS_PER_DEVICE_PER_DAY: '2',
      CRON_SECRET: 'e2e-secret',
      DATABASE_URL: '',
    },
  },
});
