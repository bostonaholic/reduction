/**
 * Shared sanitation for the recipe source URL on export surfaces.
 *
 * The URL comes from location.href and ends up on artifacts the user hands to
 * other people (the print document, the exported SVG and PNG), so one policy
 * decides what those surfaces may show and link. Escaping stays per-surface
 * (escapeHtml, escapeXml) — only the URL policy is shared.
 */

/** Drop any #fragment — never needed to reach a page, and often a token carrier. */
function stripFragment(value: string): string {
  const hash = value.indexOf('#');
  return hash === -1 ? value : value.slice(0, hash);
}

/**
 * The source URL as export surfaces may show and link it: trimmed, with the
 * fragment removed. Blank in, blank out.
 */
export function sanitizeSourceUrl(value: string): string {
  return stripFragment(value.trim());
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
