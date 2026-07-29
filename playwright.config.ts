import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  // Live sites are the point of these tests; give them room and hit one at a
  // time so we look like a person browsing rather than a scraper.
  timeout: 180_000,
  workers: 1,
  fullyParallel: false,
  reporter: [['list']],
  expect: {
    // Golden master tolerance. threshold is per-pixel colour distance (font
    // antialiasing moves individual pixels slightly between runs);
    // maxDiffPixelRatio is the share of pixels allowed to differ at all.
    // 0.2% catches any real layout change — a single shifted cell border is
    // far more than that — while surviving subpixel rendering jitter.
    toHaveScreenshot: {
      threshold: 0.15,
      maxDiffPixelRatio: 0.002,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    },
  },
  use: {
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 1000 },
    locale: 'en-US',
  },
});
