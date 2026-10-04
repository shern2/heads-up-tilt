import { defineConfig, devices } from '@playwright/test';

const PORT = 8123;
const BASE = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL: BASE,
    viewport: { width: 900, height: 500 }, // landscape phone-ish
    trace: 'on-first-retry',
  },
  webServer: {
    command: `python3 -m http.server ${PORT} --bind 127.0.0.1`,
    url: `${BASE}/index.html`,
    reuseExistingServer: !process.env.CI,
    timeout: 20_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
