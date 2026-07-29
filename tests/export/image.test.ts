import { describe, expect, it } from 'vitest';
import { stripFragment, truncateToWidth } from '../../src/export/image.js';

/** Fake measurer: ten pixels per character, so no canvas is needed. */
const width = (s: string): number => s.length * 10;

describe('truncateToWidth', () => {
  it('leaves text that fits unchanged', () => {
    expect(truncateToWidth('short', 100, width)).toBe('short');
  });

  it('leaves an exact fit unchanged, with no ellipsis', () => {
    expect(truncateToWidth('exactly 10', 100, width)).toBe('exactly 10');
  });

  it('trims a too-wide text and appends an ellipsis so the result fits', () => {
    // Pinned to the exact maximal fit — at 10px/char into 100px, that is the
    // 9-char prefix plus the ellipsis. A looser assertion would also pass for
    // a degenerate implementation returning a bare '…'.
    expect(truncateToWidth('http://golden.local/a-very-long-path.html', 100, width)).toBe(
      'http://go…',
    );
  });

  it('returns an empty string for empty input', () => {
    expect(truncateToWidth('', 100, width)).toBe('');
  });
});

describe('stripFragment', () => {
  it('drops the fragment but keeps the query string', () => {
    expect(stripFragment('https://example.test/r?p=1#access_token=abc')).toBe(
      'https://example.test/r?p=1',
    );
  });

  it('leaves a fragment-free url unchanged', () => {
    expect(stripFragment('https://example.test/r?p=1')).toBe('https://example.test/r?p=1');
  });
});
