/** Settings page: the API key and whether the Claude fallback may run. */

import { STORAGE_KEYS } from '../messages.js';

const keyInput = document.getElementById('key') as HTMLInputElement;
const enabledInput = document.getElementById('enabled') as HTMLInputElement;
const saveButton = document.getElementById('save') as HTMLButtonElement;
const status = document.getElementById('status') as HTMLSpanElement;

async function load(): Promise<void> {
  const stored = await chrome.storage.local.get([STORAGE_KEYS.apiKey, STORAGE_KEYS.useClaude]);
  keyInput.value = (stored[STORAGE_KEYS.apiKey] as string | undefined) ?? '';
  enabledInput.checked = stored[STORAGE_KEYS.useClaude] !== false;
}

saveButton.addEventListener('click', async () => {
  await chrome.storage.local.set({
    [STORAGE_KEYS.apiKey]: keyInput.value.trim(),
    [STORAGE_KEYS.useClaude]: enabledInput.checked,
  });
  status.textContent = 'Saved';
  setTimeout(() => (status.textContent = ''), 2000);
});

void load();
