/**
 * CLI argument parsing.
 *
 * Hand-rolled: the surface is one URL and three flags, which does not justify
 * a parsing dependency (the repo precedent is build.mjs checking
 * process.argv directly). Pure — argv in, a discriminated result out — so it
 * unit-tests without spawning a process.
 */

import { stripControls } from './sanitize.js';

/**
 * The full planned format set; FORMATS below is the runtime whitelist and
 * grows as each format's dispatch arm lands.
 */
export type OutputFormat = 'text' | 'json' | 'html' | 'svg' | 'png' | 'pdf';

/** Exported so the skill drift test binds SKILL.md to the real format list. */
export const FORMATS: readonly OutputFormat[] = ['text', 'json', 'html', 'svg', 'png'];

export type ParsedArgs =
  | { kind: 'run'; url: string; format: OutputFormat; claude: boolean }
  | { kind: 'help' }
  | { kind: 'error'; message: string };

export const USAGE = `Usage: reduction <url> [--format text|json|html|svg|png] [--claude] [--help]

Fetch a recipe page and print it as a tabular diagram.

Formats:
  text   a box-drawing table for the terminal (default)
  json   the recipe, grid, and confidence note as JSON
  html   the same markup the extension renders
  svg    the extension's diagram as a standalone SVG image
  png    the same diagram rasterized at 2x

png output is binary: redirect it to a file (> out.png) — a terminal
refuses it with exit 2. It needs the optional @resvg/resvg-js dependency;
if that is missing (exit 2), reinstall without --omit=optional, or run:
npm install @resvg/resvg-js

Options:
  --claude   when the local parse is low-confidence, ask Claude to improve it
             (uses ANTHROPIC_API_KEY and spends your API budget)
  --help     show this message

Exit codes: 0 success, 1 operational failure (reason on stderr), 2 usage error.

Some major recipe sites block scripted requests: expect HTTP 403 and exit 1
there even though the page loads fine in a browser.
`;

export function parseArgs(argv: string[]): ParsedArgs {
  let url: string | undefined;
  let format: OutputFormat = 'text';
  let claude = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help') return { kind: 'help' };
    if (arg === '--claude') {
      claude = true;
      continue;
    }
    if (arg === '--format') {
      const value = argv[++i];
      if (!value || !(FORMATS as readonly string[]).includes(value)) {
        return { kind: 'error', message: `unknown format: ${stripControls(value ?? '(missing)')}` };
      }
      format = value as OutputFormat;
      continue;
    }
    if (arg.startsWith('--')) {
      return { kind: 'error', message: `unknown flag: ${stripControls(arg)}` };
    }
    if (url !== undefined) {
      return { kind: 'error', message: `unexpected argument: ${stripControls(arg)}` };
    }
    url = arg;
  }

  if (url === undefined) return { kind: 'error', message: 'missing <url> argument' };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // An unparseable string can still contain user:password@ material, so
    // the message never echoes it.
    return { kind: 'error', message: 'not a valid URL' };
  }
  // Embedded credentials would flow into the recipe's sourceUrl and print in
  // the output; refuse them rather than leak them. Checked before the
  // protocol branch below so that no error message ever echoes them, and
  // omitted from this message for the same reason.
  if (parsed.username !== '' || parsed.password !== '') {
    return { kind: 'error', message: 'URLs with embedded credentials are not supported' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { kind: 'error', message: `only http(s) URLs are supported: ${stripControls(url)}` };
  }

  return { kind: 'run', url, format, claude };
}
