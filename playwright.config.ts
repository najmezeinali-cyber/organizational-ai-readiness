import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.APP_URL || 'http://127.0.0.1:3100';
const chrome = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  expect: { timeout: 12_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: { baseURL, browserName: 'chromium', headless: true, launchOptions: { executablePath: chrome }, trace: 'retain-on-failure', screenshot: 'only-on-failure', video: 'off' },
  webServer: { command: 'npm run dev -- --port 3100', url: `${baseURL}/`, timeout: 120_000, reuseExistingServer: false, env: { ...process.env, APP_URL: baseURL, DATA_DIR: '.data/e2e', MAIL_MODE: 'file', NODE_ENV: 'development' } },
});
