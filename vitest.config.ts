import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // jsdom is noisy about the CSS on real recipe pages; the parser does not care.
    onConsoleLog: (log) => !log.includes('Could not parse CSS'),
  },
});
