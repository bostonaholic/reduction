/** The only things the content script and the service worker say to each other. */

export interface OpenPrintView {
  type: 'open-print-view';
  /** Full standalone HTML document for the printable page. */
  html: string;
}

export interface InferWithClaude {
  type: 'infer-with-claude';
  title: string;
  ingredients: string[];
  steps: string[];
}

export type Message = OpenPrintView | InferWithClaude;

export interface ClaudeReply {
  ok: boolean;
  /** The inferred tree, shaped like the schema in llm/claude.ts. */
  tree?: unknown;
  error?: string;
}

/** Key used for both the stored API key and the handoff to the print view. */
export const STORAGE_KEYS = {
  apiKey: 'anthropicApiKey',
  useClaude: 'useClaudeFallback',
  model: 'claudeModel',
  printPayload: 'printPayload',
} as const;
