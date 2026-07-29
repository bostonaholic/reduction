/**
 * Acceptance tests for the agent Skill (slice 6 of
 * docs/plans/2026-07-29-cli-and-agent-skill).
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
});
