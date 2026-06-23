import { defineConfig, devices } from '@playwright/test';

// E2E runs against a real deployment (default: live). Override with BASE_URL,
// e.g. BASE_URL=http://localhost:8001 npm run e2e (serve docs/ first).
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: process.env.BASE_URL || 'https://recipes.cartergividen.com',
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } }, // mom's main device
  ],
});
