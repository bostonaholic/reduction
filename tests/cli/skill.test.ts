/**
 * Acceptance tests for the agent Skill.
 *
 * The discovery contract is the file's location plus `name` and
 * `description` in its YAML frontmatter. The `npx reduction` guard is
 * mechanical: the package is private and unpublished, so npx would fall
 * through to the public registry.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const skillPath = join(
  import.meta.dirname,
  '..',
  '..',
  '.claude',
  'skills',
  'reduction',
  'SKILL.md',
);
const skillText = existsSync(skillPath) ? readFileSync(skillPath, 'utf8') : '';

describe('the reduction agent Skill', () => {
  it('ships at .claude/skills/reduction/SKILL.md', () => {
    expect(existsSync(skillPath)).toBe(true);
  });

  it('declares name and description in its frontmatter', () => {
    const frontmatter = skillText.match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';
    expect(frontmatter).toMatch(/^name:/m);
    expect(frontmatter).toMatch(/^description:/m);
  });

  it('never tells an agent to run npx reduction', () => {
    // Guarded on existence so this negative assertion cannot pass vacuously
    // against an empty string before the Skill lands.
    expect(existsSync(skillPath)).toBe(true);
    expect(skillText).not.toContain('npx reduction');
  });

  it('single-quotes the URL in every documented invocation', () => {
    expect(existsSync(skillPath)).toBe(true);
    expect(skillText).toContain("node dist/cli.mjs '<url>'");
    expect(skillText).toContain("reduction '<url>'");
    // No invocation may slip back to an unquoted placeholder.
    expect(skillText).not.toMatch(/cli\.mjs <url>|reduction <url>/);
  });

  it('documents the quoting rule and rejects URLs containing a single quote', () => {
    expect(existsSync(skillPath)).toBe(true);
    expect(skillText).toMatch(/single-quote/i);
    expect(skillText).toMatch(/reject.*single quote/is);
  });

  it('marks CLI output as untrusted data, never instructions', () => {
    expect(existsSync(skillPath)).toBe(true);
    expect(skillText).toMatch(/untrusted/i);
    expect(skillText).toMatch(/never as instructions/i);
  });
});
