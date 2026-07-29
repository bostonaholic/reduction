/**
 * The print tab.
 *
 * The service worker stashes a complete HTML document in extension storage and
 * opens this page; we load it into an iframe with srcdoc, which gives the table
 * its own document to print without inheriting anything from this page.
 */

import { STORAGE_KEYS } from '../messages.js';

const frame = document.getElementById('view') as HTMLIFrameElement;
const button = document.getElementById('print') as HTMLButtonElement;

async function load(): Promise<void> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.printPayload);
  const html = stored[STORAGE_KEYS.printPayload] as string | undefined;

  if (!html) {
    frame.srcdoc = '<p style="font-family:sans-serif;padding:24px">Nothing to print.</p>';
    return;
  }

  frame.srcdoc = html;
  // The payload is a one-shot handoff; leaving it around would print a stale
  // recipe the next time this page opens.
  await chrome.storage.local.remove(STORAGE_KEYS.printPayload);
}

button.addEventListener('click', () => {
  frame.contentWindow?.focus();
  frame.contentWindow?.print();
});

void load();
