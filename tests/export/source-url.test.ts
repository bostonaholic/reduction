import { describe, expect, it } from 'vitest';
import { isHttpUrl, sanitizeSourceUrl } from '../../src/export/source-url.js';

describe('sanitizeSourceUrl', () => {
  it('drops the fragment but keeps the query string', () => {
    expect(sanitizeSourceUrl('https://example.test/r?p=1#access_token=abc')).toBe(
      'https://example.test/r?p=1',
    );
  });

  it('leaves a fragment-free url unchanged', () => {
    expect(sanitizeSourceUrl('https://example.test/r?p=1')).toBe('https://example.test/r?p=1');
  });

  it('trims surrounding whitespace', () => {
    expect(sanitizeSourceUrl('  https://example.test/r  ')).toBe('https://example.test/r');
  });
});

describe('isHttpUrl', () => {
  it('accepts http and https urls', () => {
    expect(isHttpUrl('http://example.test/r')).toBe(true);
    expect(isHttpUrl('https://example.test/r')).toBe(true);
  });

  it('rejects other schemes and unparsable text', () => {
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('not a url')).toBe(false);
  });
});
