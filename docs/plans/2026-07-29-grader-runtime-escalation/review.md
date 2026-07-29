---
topic: grader-runtime-escalation
date: 2026-07-29
phase: review
verdict: NOT RUN
---

# Aggregate review gate — did not run

Five reviewers were dispatched in parallel (`code-reviewer`,
`security-reviewer`, `technical-writer`, `ux-reviewer`, `verifier`). Each was
prompted three times, including a final request for a single verdict line.

**All five went idle without delivering any report. No verdict exists from any
of them.** Fifteen idle notifications, zero content.

This record exists so the gate's absence is visible at PR review rather than
implied by silence. The PR is opened as a **draft** on that basis.

## What IS established — mechanically, reproducibly

Run by the orchestrator, commands and output read directly:

| Check | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npx vitest run` | 141 passed, 1 file skipped |
| `npx playwright test golden + install` | 19 passed (was 16 before this change) |
| `npm run build` | succeeds; `dist/` emitted |
| `git diff ce8358b HEAD -- tests/` | **empty** — the acceptance tests were not edited to make them pass |
| `src/core/escalate.ts` purity | no DOM, no `chrome.*`; imports only `grade.js`, `types.js` |
| step-6 guard | `favoured.confidence >= other.confidence * RETAIN_RATIO - EPSILON`, `RETAIN_RATIO = 0.75`, `EPSILON = 1e-9`, favoured = `new Set(findings.map(f => f.rule)).size` — matches the approved design |
| escape ordering | `confidenceNote` truncates raw text at 120, `showTable` calls `escape(note.text)` at `index.ts:117`. Truncate-then-escape cannot sever an HTML entity; the reverse order could |
| README claim | `"only below 60% confidence"` removed; no doc still calls the grader test-only |

The skipped test file is `tests/sites.test.ts` — `tests/fixtures/*.html` is
gitignored and absent in a fresh worktree. Pre-existing, unrelated to this
change.

## What is NOT established

Independent adversarial review of the code, the security surface, and the live
UX. The orchestrator ran the implementation, so its own sign-off is exactly the
self-evaluation bias the panel exists to prevent — the same reason the design
phase refused to self-certify its gate.

Specifically unreviewed by a fresh context:

- Whether the seven-step selection rule has a defect the design review missed.
- Whether a hostile page can amplify Anthropic API calls on the user's own key,
  now that escalation is more frequent. Bounded at one call per `run()` by
  construction, but the *rate* across page views is unexamined.
- Whether grading is a resource-exhaustion vector on a page with a pathological
  ingredient count, since grading now runs on every card rather than in tests.
- Whether the badge note reads as help or as developer jargon to an actual cook.

These are the questions a human reviewer should carry into the PR.
