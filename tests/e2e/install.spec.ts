/**
 * Proves the extension actually installs and boots in Chrome.
 *
 * Loads dist/ unpacked in a persistent context, waits for the Manifest V3
 * service worker to register, and opens the options page from its real
 * chrome-extension:// origin.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test, chromium, type BrowserContext } from '@playwright/test';

const DIST = join(import.meta.dirname, '..', '..', 'dist');

let context: BrowserContext;
let profileDir: string;

test.beforeAll(async () => {
  profileDir = await mkdtemp(join(tmpdir(), 'recipart-profile-'));
  context = await chromium.launchPersistentContext(profileDir, {
    // Extensions need Chromium's new headless mode; the old one ignores them.
    channel: 'chromium',
    args: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`],
  });
});

test.afterAll(async () => {
  await context?.close();
  await rm(profileDir, { recursive: true, force: true });
});

test('registers its service worker when loaded unpacked', async () => {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 30_000 });

  expect(worker.url()).toContain('background.js');

  const extensionId = new URL(worker.url()).host;
  expect(extensionId).toMatch(/^[a-p]{32}$/);
});

test('exposes a working options page', async () => {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
  const extensionId = new URL(worker.url()).host;

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);

  await expect(page.locator('h1')).toHaveText('Recipart');
  await expect(page.locator('#key')).toBeVisible();

  // The key round-trips through extension storage.
  await page.fill('#key', 'sk-ant-test-key');
  await page.click('#save');
  await expect(page.locator('#status')).toHaveText('Saved');

  await page.reload();
  await expect(page.locator('#key')).toHaveValue('sk-ant-test-key');

  await page.close();
});

test('declares a valid Manifest V3 manifest', async () => {
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 30_000 });
  const extensionId = new URL(worker.url()).host;

  const page = await context.newPage();
  const response = await page.goto(`chrome-extension://${extensionId}/manifest.json`);
  const manifest = JSON.parse((await response!.text()).trim());

  expect(manifest.manifest_version).toBe(3);
  expect(manifest.permissions).toContain('activeTab');
  expect(manifest.permissions).toContain('scripting');
  // No broad host access: the extension only reaches a page the user clicked on.
  expect(manifest.host_permissions).toEqual(['https://api.anthropic.com/*']);

  await page.close();
});
