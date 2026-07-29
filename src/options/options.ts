/** Settings page: the API key, the model, and whether the Claude fallback may run. */

import { MODELS, resolveModel } from '../llm/claude.js';
import { STORAGE_KEYS } from '../messages.js';

const keyInput = document.getElementById('key') as HTMLInputElement;
const modelSelect = document.getElementById('model') as HTMLSelectElement;
const enabledInput = document.getElementById('enabled') as HTMLInputElement;
const saveButton = document.getElementById('save') as HTMLButtonElement;
const status = document.getElementById('status') as HTMLSpanElement;

for (const model of MODELS) {
  modelSelect.add(new Option(model.label, model.id));
}

async function load(): Promise<void> {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.apiKey,
    STORAGE_KEYS.useClaude,
    STORAGE_KEYS.model,
  ]);
  keyInput.value = (stored[STORAGE_KEYS.apiKey] as string | undefined) ?? '';
  enabledInput.checked = stored[STORAGE_KEYS.useClaude] !== false;
  modelSelect.value = resolveModel(stored[STORAGE_KEYS.model] as string | undefined).id;
}

saveButton.addEventListener('click', async () => {
  await chrome.storage.local.set({
    [STORAGE_KEYS.apiKey]: keyInput.value.trim(),
    [STORAGE_KEYS.useClaude]: enabledInput.checked,
    [STORAGE_KEYS.model]: modelSelect.value,
  });
  status.textContent = 'Saved';
  setTimeout(() => (status.textContent = ''), 2000);
});

void load();
