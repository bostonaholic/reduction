/**
 * Render a recipe page as a tabular diagram, from the command line.
 *
 *   node dist/cli.mjs <url> [--format text|json|html] [--help]
 *
 * Thin shell over parseArgs and run: this file only binds the real process
 * globals; everything testable lives in args.ts and run.ts.
 */

import { parseArgs, USAGE } from './args.js';
import { run } from './run.js';

const parsed = parseArgs(process.argv.slice(2));

if (parsed.kind === 'help') {
  process.stdout.write(USAGE);
  process.exit(0);
} else if (parsed.kind === 'error') {
  process.stderr.write(`${parsed.message}\n\n${USAGE}`);
  process.exit(2);
} else {
  process.exitCode = await run(parsed, {
    fetch: (url, init) => fetch(url, init),
    stdout: process.stdout,
    stderr: process.stderr,
    env: process.env,
    // Piped output has no terminal width, so fall back to 100 columns.
    width: process.stdout.isTTY ? process.stdout.columns : 100,
  });
}
