import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './test/ui',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 8_000 },
  use: {
    baseURL: 'http://127.0.0.1:3198',
    channel: 'chromium',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } },
    { name: 'mobile', use: { ...devices['iPhone 13'], defaultBrowserType: 'chromium' } },
  ],
  webServer: [
    {
      command: 'npm run assistente -- --port 3198 --exemplo --embedder hash --store memory --llm simulated',
      url: 'http://127.0.0.1:3198/api/config',
      reuseExistingServer: false,
    },
    {
      command: 'npm run assistente -- --port 3199 --embedder hash --store memory --llm simulated',
      url: 'http://127.0.0.1:3199/api/config',
      reuseExistingServer: false,
    },
  ],
});
