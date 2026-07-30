/**
 * Service worker.
 *
 * Two jobs: inject the content script when the toolbar button is clicked, and
 * do the two things a content script is not allowed to do — call the Claude
 * API across origins, and open an extension page for printing.
 */

import { callClaude, resolveEffort, resolveModel } from './llm/claude.js';
import { STORAGE_KEYS, type ClaudeReply, type Message } from './messages.js';

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  } catch (err) {
    // Chrome refuses injection on its own pages and the Web Store; say so
    // rather than failing silently.
    console.warn('Reduction could not run on this page:', err);
  }
});

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  if (message.type === 'open-print-view') {
    void chrome.storage.local
      .set({ [STORAGE_KEYS.printPayload]: message.html })
      .then(() => chrome.tabs.create({ url: chrome.runtime.getURL('print.html') }));
    return false;
  }

  if (message.type === 'infer-with-claude') {
    // Returning true keeps the message channel open for the async reply.
    void (async () => {
      const stored = await chrome.storage.local.get([
        STORAGE_KEYS.apiKey,
        STORAGE_KEYS.useClaude,
        STORAGE_KEYS.model,
        STORAGE_KEYS.effort,
      ]);
      const apiKey = stored[STORAGE_KEYS.apiKey] as string | undefined;
      const enabled = stored[STORAGE_KEYS.useClaude] !== false;

      if (!enabled || !apiKey) {
        sendResponse({ ok: false, error: 'no-api-key' } satisfies ClaudeReply);
        return;
      }

      const settings = {
        apiKey,
        model: resolveModel(stored[STORAGE_KEYS.model] as string | undefined),
        effort: resolveEffort(stored[STORAGE_KEYS.effort] as string | undefined),
        // The service worker calls the API from a browser context.
        browser: true,
      };

      try {
        const tree = await callClaude(
          settings,
          message.title,
          message.ingredients,
          message.steps,
        );
        sendResponse({ ok: true, tree } satisfies ClaudeReply);
      } catch (err) {
        sendResponse({ ok: false, error: (err as Error).message } satisfies ClaudeReply);
      }
    })();
    return true;
  }

  return false;
});
