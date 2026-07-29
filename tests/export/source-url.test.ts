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

  it('drops credential-shaped query parameters and keeps identity ones', () => {
    expect(
      sanitizeSourceUrl('https://example.test/r?p=123&access_token=abc&recipeId=9&sig=x'),
    ).toBe('https://example.test/r?p=123&recipeId=9');
  });

  it('matches credential parameter names case-insensitively', () => {
    expect(sanitizeSourceUrl('https://example.test/r?Token=a&UNLOCKED_ARTICLE_CODE=b&id=7')).toBe(
      'https://example.test/r?id=7',
    );
  });

  it('drops the ? as well when every parameter is credential-shaped', () => {
    expect(sanitizeSourceUrl('https://example.test/r?token=a&key=b')).toBe(
      'https://example.test/r',
    );
  });

  it('does not scrub on name substrings — keyword and sessions are not key and session', () => {
    expect(sanitizeSourceUrl('https://example.test/r?keyword=pie&sessions=3')).toBe(
      'https://example.test/r?keyword=pie&sessions=3',
    );
  });

  it('scrubs a credential behind a legacy ; separator', () => {
    expect(sanitizeSourceUrl('https://example.test/r?p=1;token=SECRET')).toBe(
      'https://example.test/r?p=1',
    );
  });

  it('keeps an identity parameter behind a legacy ; separator', () => {
    expect(sanitizeSourceUrl('https://example.test/r?token=SECRET;p=1')).toBe(
      'https://example.test/r?p=1',
    );
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
