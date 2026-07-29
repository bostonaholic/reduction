/**
 * Render a recipe page as a tabular diagram, from the command line.
 *
 *   node dist/cli.mjs <url> [--format text|json|html] [--claude] [--help]
 *
 * Thin shell over parseArgs and run: this file only binds the real process
 * globals; everything testable lives in args.ts and run.ts.
 */

import { parseArgs, USAGE } from './args.js';
import { run } from './run.js';

// A consumer that closes stdout early (`… | head`) took what it wanted;
// exiting 0 quietly honors that, where crashing on EPIPE would not. The
// listener covers writes that fail asynchronously. Any other stdout failure
// (ENOSPC, EIO) is an operational failure: rethrowing from an EventEmitter
// handler would become an uncaught exception — a stack trace with local
// paths, outside the 0/1/2 exit contract — so report one line and exit 1.
process.stdout.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EPIPE') process.exit(0);
  process.stderr.write(`stdout write failed${err.code ? ` (${err.code})` : ''}\n`);
  process.exit(1);
});

const parsed = parseArgs(process.argv.slice(2));

if (parsed.kind === 'help') {
  process.stdout.write(USAGE);
  process.exit(0);
} else if (parsed.kind === 'error') {
  process.stderr.write(`${parsed.message}\n\n${USAGE}`);
  process.exit(2);
} else {
  try {
    process.exitCode = await run(parsed, {
      fetch: (url, init) => fetch(url, init),
      stdout: process.stdout,
      stderr: process.stderr,
      env: process.env,
      // Piped output has no terminal width, so fall back to 100 columns.
      width: process.stdout.isTTY ? process.stdout.columns : 100,
    });
  } catch (err) {
    // The synchronous half of the EPIPE contract above.
    if ((err as NodeJS.ErrnoException).code === 'EPIPE') process.exitCode = 0;
    else throw err;
  }
}
