import { defineConfig, devices } from '@playwright/test';

function requireLoopbackOrigin(): string {
  const serialized = process.env['WISER_WEB_LIVE_BASE_URL'];
  if (serialized === undefined || serialized.length === 0) {
    throw new Error(
      'WISER_WEB_LIVE_BASE_URL is required for authenticated browser tests.',
    );
  }
  let origin: URL;
  try {
    origin = new URL(serialized);
  } catch (error) {
    throw new Error('WISER_WEB_LIVE_BASE_URL must be a valid URL.', {
      cause: error,
    });
  }
  if (
    origin.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost', '::1', '[::1]'].includes(origin.hostname) ||
    origin.username !== '' ||
    origin.password !== '' ||
    origin.pathname !== '/' ||
    origin.search !== '' ||
    origin.hash !== ''
  ) {
    throw new Error('WISER_WEB_LIVE_BASE_URL must be a loopback HTTP origin.');
  }
  return origin.origin;
}

export default defineConfig({
  testDir: './e2e-live',
  outputDir: 'test-results-live',
  forbidOnly: true,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI
    ? [
        ['dot'],
        ['html', { open: 'never', outputFolder: 'playwright-report-live' }],
      ]
    : 'list',
  use: {
    baseURL: requireLoopbackOrigin(),
    screenshot: 'only-on-failure',
    trace: 'off',
    video: 'off',
  },
  projects: [{ name: 'chromium-live', use: { ...devices['Desktop Chrome'] } }],
});
