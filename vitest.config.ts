import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // The opt-in deep-nesting stress test in tests/cli/run.test.ts
    // (REDUCTION_STRESS=1) relies on jsdom overflowing a child process's
    // ~1 MiB default stack; worker threads get a 4 MiB stack where 16,000
    // nested divs grind for minutes instead of overflowing. Pin the pool so
    // a config drift cannot turn it into a hang.
    pool: 'forks',
    // jsdom is noisy about the CSS on real recipe pages; the parser does not care.
    onConsoleLog: (log) => !log.includes('Could not parse CSS'),
  },
});
