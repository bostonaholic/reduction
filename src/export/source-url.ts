/**
 * Shared sanitation for the recipe source URL on export surfaces.
 *
 * The URL comes from location.href and ends up on artifacts the user hands to
 * other people (the print document, the exported SVG and PNG), so one policy
 * decides what those surfaces may show and link. Escaping stays per-surface
 * (escapeHtml, escapeXml) — only the URL policy is shared.
 */

/** Query parameters whose names carry credentials rather than recipe identity. */
const CREDENTIAL_PARAMS = new Set([
  'token',
  'access_token',
  'auth',
  'key',
  'sig',
  'signature',
  'session',
  'password',
  'unlocked_article_code',
]);

/** Drop any #fragment — never needed to reach a page, and often a token carrier. */
function stripFragment(value: string): string {
  const hash = value.indexOf('#');
  return hash === -1 ? value : value.slice(0, hash);
}

/**
 * Drop query parameters with credential-shaped names, matched exactly and
 * case-insensitively. The rest of the query survives byte-for-byte: on many
 * sites it carries the recipe's identity (?p=, ?recipeId=), so it cannot be
 * dropped wholesale without breaking the link.
 */
function scrubQuery(value: string): string {
  const q = value.indexOf('?');
  if (q === -1) return value;
  const kept = value
    .slice(q + 1)
    .split('&')
    .filter((pair) => !CREDENTIAL_PARAMS.has(pair.split('=', 1)[0].toLowerCase()));
  return kept.length ? `${value.slice(0, q)}?${kept.join('&')}` : value.slice(0, q);
}

/**
 * The source URL as export surfaces may show and link it: trimmed, with the
 * fragment and credential-shaped query parameters removed. Blank in, blank
 * out.
 */
export function sanitizeSourceUrl(value: string): string {
  return scrubQuery(stripFragment(value.trim()));
}

/** Only http(s) URLs earn a link — anything else stays inert text. */
export function isHttpUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol;
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}
