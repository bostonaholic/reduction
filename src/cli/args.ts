/**
 * CLI argument parsing.
 *
 * Hand-rolled: the surface is one URL and three flags, which does not justify
 * a parsing dependency (the repo precedent is build.mjs checking
 * process.argv directly). Pure — argv in, a discriminated result out — so it
 * unit-tests without spawning a process.
 */

export type OutputFormat = 'json' | 'html';

const FORMATS: readonly OutputFormat[] = ['json', 'html'];

export type ParsedArgs =
  | { kind: 'run'; url: string; format: OutputFormat; claude: boolean }
  | { kind: 'help' }
  | { kind: 'error'; message: string };

export const USAGE = `Usage: reduction <url> [--format json|html] [--help]

Fetch a recipe page and print it as a tabular diagram.

Formats:
  json   the recipe, grid, and confidence note as JSON (default)
  html   the same markup the extension renders

Options:
  --help   show this message
`;

export function parseArgs(argv: string[]): ParsedArgs {
  let url: string | undefined;
  let format: OutputFormat = 'json';

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help') return { kind: 'help' };
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

  return { kind: 'run', url, format, claude: false };
}
