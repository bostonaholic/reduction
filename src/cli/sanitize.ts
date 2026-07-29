/**
 * Terminal hygiene for CLI messages.
 *
 * Page text takes a similar strip in plainText at extraction — though that
 * one keeps ZWNJ/ZWJ, which real recipes need — but argv values and remote
 * API responses reach stderr without passing through it. The Skill tells
 * the agent to relay stderr lines to the user, so anything derived from
 * those sources is stripped before interpolation into a message. The
 * aggressive strip here is fine because it only ever touches error text,
 * never recipe content.
 */

/**
 * C0/C1 controls and DEL (an ESC starts an ANSI sequence that can repaint
 * the screen or forge output), plus the invisible bidi and zero-width code
 * points (U+200B–U+200F, U+202A–U+202E, U+2066–U+2069) that survive a
 * control-only strip and can reorder or hide rendered text.
 */
const UNPRINTABLE = /[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g;

/** Strip characters that could manipulate a terminal from untrusted text. */
export function stripControls(text: string): string {
  return text.replace(UNPRINTABLE, '');
}
