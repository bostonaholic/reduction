/**
 * CLI argument parsing.
 *
 * Hand-rolled: the surface is one URL and three flags, which does not justify
 * a parsing dependency (the repo precedent is build.mjs checking
 * process.argv directly). Pure — argv in, a discriminated result out — so it
 * unit-tests without spawning a process.
 */

export type OutputFormat = 'text' | 'json' | 'html';

const FORMATS: readonly OutputFormat[] = ['text', 'json', 'html'];

export type ParsedArgs =
  | { kind: 'run'; url: string; format: OutputFormat; claude: boolean }
  | { kind: 'help' }
  | { kind: 'error'; message: string };

export const USAGE = `Usage: reduction <url> [--format text|json|html] [--claude] [--help]

Fetch a recipe page and print it as a tabular diagram.

Formats:
  text   a box-drawing table for the terminal (default)
  json   the recipe, grid, and confidence note as JSON
  html   the same markup the extension renders

Options:
  --claude   when the local parse is low-confidence, ask Claude to improve it
             (uses ANTHROPIC_API_KEY and spends your API budget)
  --help     show this message
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
        return { kind: 'error', message: `unknown format: ${value ?? '(missing)'}` };
      }
      format = value as OutputFormat;
      continue;
    }
    if (arg.startsWith('--')) return { kind: 'error', message: `unknown flag: ${arg}` };
    if (url !== undefined) return { kind: 'error', message: `unexpected argument: ${arg}` };
    url = arg;
  }

  if (url === undefined) return { kind: 'error', message: 'missing <url> argument' };

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { kind: 'error', message: `not a valid URL: ${url}` };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { kind: 'error', message: `only http(s) URLs are supported: ${url}` };
  }
  // Embedded credentials would flow into the recipe's sourceUrl and print in
  // the output; refuse them rather than leak them. The message deliberately
  // omits the URL for the same reason.
  if (parsed.username !== '' || parsed.password !== '') {
    return { kind: 'error', message: 'URLs with embedded credentials are not supported' };
  }

  return { kind: 'run', url, format, claude };
}
