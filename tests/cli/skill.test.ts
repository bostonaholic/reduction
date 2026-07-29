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

describe('the reduction agent Skill stays in step with the CLI formats', () => {
  it('quotes the exact --format list built from the exported FORMATS (slice 1)', async () => {
    expect(existsSync(skillPath)).toBe(true);
    // Dynamic import: a static named import of a not-yet-exported const
    // would error the whole file instead of failing this test.
    const mod = (await import('../../src/cli/args.js')) as unknown as Record<string, unknown>;
    const formats = mod.FORMATS as readonly string[] | undefined;
    expect(formats, 'src/cli/args.ts must export FORMATS').toBeDefined();
    // The exact joined string: per-member substring checks pass vacuously,
    // because words like "text" already appear in the Skill's prose.
    expect(skillText).toContain(`--format ${formats!.join('|')}`);
  });

  it('tells the agent png and pdf are binary and must be redirected to a file (slice 3)', () => {
    expect(existsSync(skillPath)).toBe(true);
    expect(skillText).toMatch(/binary/i);
    expect(skillText).toMatch(/redirect/i);
  });
});
