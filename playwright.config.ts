import { defineConfig } from '@playwright/test';

/*
 * Keep the app off screen for the whole run.
 *
 * Every spec launches the packaged app, often several times, and a run does so
 * well over a hundred times. Each launch used to raise a window and take the
 * keyboard focus, which makes the machine unusable while the suite runs and
 * flashes the screen once per test. Playwright drives the page over the
 * debugging protocol, which does not care whether the window is visible.
 *
 * Set here rather than in each spec because `electron.launch` inherits this
 * process's environment, so one line covers every launch in every file,
 * including any added later.
 */
process.env.NOTO_HEADLESS = '1';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results/playwright',
  use: { trace: 'retain-on-failure' },
});

