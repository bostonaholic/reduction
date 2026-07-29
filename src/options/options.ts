/**
 * Settings page: the API key, the model and its effort level, and whether the
 * Claude fallback may run at all.
 */

import { EFFORT_LABELS, EFFORTS, MODELS, resolveEffort, resolveModel } from '../llm/claude.js';
import { STORAGE_KEYS } from '../messages.js';

const keyInput = document.getElementById('key') as HTMLInputElement;
const modelSelect = document.getElementById('model') as HTMLSelectElement;
const effortSelect = document.getElementById('effort') as HTMLSelectElement;
const effortUnsupported = document.getElementById('effort-unsupported') as HTMLParagraphElement;
const enabledInput = document.getElementById('enabled') as HTMLInputElement;
const saveButton = document.getElementById('save') as HTMLButtonElement;
const status = document.getElementById('status') as HTMLSpanElement;

for (const model of MODELS) {
  modelSelect.add(new Option(model.label, model.id));
}
for (const effort of EFFORTS) {
  effortSelect.add(new Option(EFFORT_LABELS[effort], effort));
}

/**
 * Not every model accepts an effort level. Rather than let the picker imply a
 * setting that the request will drop, disable it and say so — the stored value
 * is left alone, so switching back restores the choice.
 */
function syncEffortAvailability(): void {
  const supported = resolveModel(modelSelect.value).supportsEffort;
  effortSelect.disabled = !supported;
  effortUnsupported.hidden = supported;
}

modelSelect.addEventListener('change', syncEffortAvailability);

async function load(): Promise<void> {
  const stored = await chrome.storage.local.get([
    STORAGE_KEYS.apiKey,
    STORAGE_KEYS.useClaude,
    STORAGE_KEYS.model,
    STORAGE_KEYS.effort,
  ]);
  keyInput.value = (stored[STORAGE_KEYS.apiKey] as string | undefined) ?? '';
  enabledInput.checked = stored[STORAGE_KEYS.useClaude] !== false;
  modelSelect.value = resolveModel(stored[STORAGE_KEYS.model] as string | undefined).id;
  effortSelect.value = resolveEffort(stored[STORAGE_KEYS.effort] as string | undefined);
  syncEffortAvailability();
}

saveButton.addEventListener('click', async () => {
  await chrome.storage.local.set({
    [STORAGE_KEYS.apiKey]: keyInput.value.trim(),
    [STORAGE_KEYS.useClaude]: enabledInput.checked,
    [STORAGE_KEYS.model]: modelSelect.value,
    [STORAGE_KEYS.effort]: effortSelect.value,
  });
  status.textContent = 'Saved';
  setTimeout(() => (status.textContent = ''), 2000);
});

void load();
