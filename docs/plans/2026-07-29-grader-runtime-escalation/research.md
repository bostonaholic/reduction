---
topic: grader-runtime-escalation
date: 2026-07-29
phase: research
---

# Research: grader-runtime-escalation

> **Dispatch note.** RESEARCH dispatches `file-finder` and `researcher` in
> parallel. The `researcher` returned the report below. The `file-finder`
> produced no artifact within ~30 minutes and was not waited on further; its
> role is locating relevant files, which this report covers directly — every
> claim carries a `path:line` citation. Recorded here so the gap is visible at
> review rather than implied by silence.


## Topology

**Q1 — Where the second-pass decision is made, and what it reads.**
`src/content/index.ts:207` — `if (recipe.confidence < CLAUDE_THRESHOLD)`. It reads exactly two values: `recipe.confidence` on the heuristic result produced at `src/content/index.ts:205` (`inferTree(raw, location.href)`), and the module constant `CLAUDE_THRESHOLD = 0.6` at `src/content/index.ts:23` (comment at line 22: "Below this, the local heuristics are not trustworthy enough to show alone"). Nothing else participates — no grading, no per-site state, no settings (settings are checked later, in the background worker).

**Q2 — Where the keep-or-discard decision is made, and what it reads.**
`src/content/index.ts:211` — `if (viaClaude.root && viaClaude.confidence >= recipe.confidence) recipe = viaClaude;`. It reads `viaClaude.root` (non-null check) and the two `Recipe.confidence` numbers; ties go to the Claude result (`>=`). Downstream fallbacks: `src/content/index.ts:215` replaces a rootless result with `flatTree(raw, location.href)`; lines 216–219 show an error if there is still no root.

**Q3 — Exports of `src/core/grade.ts`, signatures, and inputs needed at the decision points.**
- `RuleId` (`src/core/grade.ts:26-29`): union of 25 literals `'S1'…'S10' | 'F1'…'F7' | 'L1'…'L8'`.
- `Tier` (`:31`): `'S' | 'F' | 'L'`.
- `Finding` (`:33-37`): `{ rule: RuleId; detail: string }` — both required; detail "names the ingredient or step, never a bare score".
- `NEEDS_REFERENCE_CARD` (`:40`): `['F8', 'F9'] as const`.
- `tierOf(rule: RuleId): Tier` (`:42-44`): first character of the rule id.
- `LegibilityLimits` (`:474-479`): `{ columnsPerStep: number; orphanRate: number }` — both required.
- `DEFAULT_LIMITS` (`:482`): `{ columnsPerStep: 1, orphanRate: 0.8 }`.
- `GradeOptions` (`:588-594`): `{ skip?: RuleId[]; limits?: LegibilityLimits; grid?: Grid }` — all three optional.
- `gradeCard(recipe: Recipe, raw: RawRecipe, options: GradeOptions = {}): Finding[]` (`:602`). Empty result is a pass. Stops after Tier S when S1/S2 fire (`:610-613`).
- `gradeByTier(recipe: Recipe, raw: RawRecipe, options: GradeOptions = {}): Record<Tier, Finding[]>` (`:619-627`).

Inputs not available at the decision points: **none**. Both required arguments are already in scope in `run()` — `raw: RawRecipe` from `extractRecipe(document)` at `src/content/index.ts:199` and each candidate `Recipe` at lines 205/210. `options` is optional; a `Grid` may be injected but `gradeCard` computes its own via `layout(recipe)` (`src/core/grade.ts:221`).

**Q4 — Current importers of `grade.ts`.**
Only tests; no `src/` module imports it.
- `tests/sites.test.ts:16` imports `gradeByTier`; calls `gradeByTier(recipe, raw)` at `:81` and `:88` with no options, asserting each tier is empty.
- `tests/core/grade.test.ts:15-23` imports `DEFAULT_LIMITS, NEEDS_REFERENCE_CARD, gradeByTier, gradeCard, tierOf, type Finding, type RuleId`; calls `gradeCard(card, raw(), options?)` with hand-built violating cards, one `describe` block per rule.

**Q5 — Confidence text/level module.**
`confidenceNote(recipe: Recipe): { level: 'high' | 'moderate' | 'low'; text: string }` at `src/core/render.ts:45-65`. Inputs: only `recipe.inference` and `recipe.confidence`. Logic: `flat` → low; `>= 0.85` → high; `>= 0.6` → moderate; else low, with prose per strategy ("Claude worked out the groupings" / "Groupings inferred locally" / flat message). Consumed at `src/content/index.ts:100` and rendered at `:110` (badge `${note.level} confidence`) and `:118` (note text).

## Conventions

**Q6 — Test framework and layout.**
Vitest 4 (`package.json:10` — `"test": "vitest run"`; `:28` — `"vitest": "^4.1.10"`). Layout mirrors `src/`: `tests/core/<module>.test.ts` for `src/core/<module>.ts` (`tests/core/grade.test.ts`, `infer.test.ts`, `layout.test.ts`), `tests/llm/claude.test.ts`, and cross-cutting `tests/sites.test.ts` at the `tests/` root. Style: `describe`/`it` + `expect`; `grade.test.ts` pairs each violating card with a near-miss card that must not trip the rule (`tests/core/grade.test.ts:1-12`).

**Q7 — Grading output scheme and documentation.**
Tier is derived from the rule id's first character (`tierOf`, `src/core/grade.ts:42-44`). `gradeCard` concatenates structural, faithfulness, and legibility findings, filtering skips (`:602-616`); `gradeByTier` buckets into `{ S: [], F: [], L: [] }` (`:624`). The scheme is documented in `docs/recipe-card-rules.md` (rule tables §2–4, scoring §5 at `:147-164`, current enforcement §6 at `:166-189`) and in the `grade.ts` header comment (`:1-19`). Notably: "Recipe.confidence is *not* this score… A card can reach 100% confidence and still fail F6" (`docs/recipe-card-rules.md:162-164`), and "Report the rule IDs that failed, never a bare number" (`:159-160`).

**Q8 — Async error-handling pattern in `src/content/index.ts`.**
Failure is converted to `null` at the boundary, never propagated: `askClaude` (`:171-190`) wraps `chrome.runtime.sendMessage` in try/catch, treats `!reply?.ok || !reply.tree` as `null`, and is documented "Never throws — the caller has a plan B" (`:171`). The caller treats `null` as "skip the upgrade" (`:208-213`). Sync extraction uses try/catch → `showError` + early return (`:197-203`). The background worker likewise replies `{ ok: false, error }` instead of throwing (`src/background.ts:43-46, 62-64`).

## Constraints

**Q9 — Full type signatures and optionality.**
- `Finding` (`src/core/grade.ts:33-37`): `{ rule: RuleId; detail: string }` — nothing optional.
- `Tier` (`:31`): `'S' | 'F' | 'L'`.
- `RuleId` (`:26-29`): 25-literal union (S1–S10, F1–F7, L1–L8).
- `GradeOptions` (`:588-594`): `{ skip?: RuleId[]; limits?: LegibilityLimits; grid?: Grid }` — all optional.
- `Recipe` (`src/core/types.ts:55-66`): `{ title: string; banners: string[]; root: RecipeNode | null; yield?: string; sourceUrl: string; extraction: ExtractionStrategy; inference: InferenceStrategy; confidence: number }` — only `yield` is optional; `root` is nullable but required. `confidence` is documented "0–1. Fraction of ingredients we managed to attach to a step" (`:64`). `InferenceStrategy` (`:40`): `'heuristic' | 'claude' | 'flat'`.

**Q10 — `grade.ts` purity and import graph.**
No DOM or `chrome.*` usage: its only imports are core modules (`src/core/grade.ts:21-24` — `infer.js`, `ingredient.js`, `layout.js`, `types.js`), and the core layer is documented as "plain data — no DOM, no browser" (`src/core/types.ts:7`; `README.md:61`). It is **not** in `src/content/index.ts`'s import graph: the content script imports extract, infer, layout, plan, render, image, print, messages, types, and CSS (`src/content/index.ts:9-18`), and a repo-wide grep shows only the two test files import from `grade.js`.

**Q11 — Settings governing the Claude call.**
Stored in `chrome.storage.local` under keys defined at `src/messages.ts:26-32`: `apiKey: 'anthropicApiKey'`, `useClaude: 'useClaudeFallback'`, `model: 'claudeModel'`, `effort: 'claudeEffort'`. Read in `src/background.ts:34-52`; enabled defaults to true via `stored[useClaude] !== false` (`:41`); no key or disabled → `{ ok: false, error: 'no-api-key' }` (`:43-46`). Model/effort resolve with fallbacks — `resolveModel`/`resolveEffort` (`src/llm/claude.ts:83-90`), defaults `DEFAULT_MODEL` = Opus 5 (`:55`) and `DEFAULT_EFFORT` = `'low'` (`:76`). The options page reads/writes the same four keys (`src/options/options.ts:37-58`). The request itself: `callClaude` (`src/llm/claude.ts:122-172`), `max_tokens: 16000`, structured output via `PLAN_SCHEMA`.

**Q12 — Documented cost/latency/frequency constraints.**
- `src/llm/claude.ts:51-55`: default is Opus 5 because "Fable 5 costs more per recipe than this tier is worth by default".
- `src/llm/claude.ts:71-76`: default effort is `low` — "Raising it costs tokens for little gain"; labels mark low "fastest and cheapest" and max "slowest and most expensive" (`:63-69`); model labels mark cost tiers (`:35-48`).
- `README.md:68-83`: the three-tier ladder — heuristics "(always, free, offline)", Claude "(only below 60% confidence, only with a key you supply)".
- `README.md:90-94`: `api.anthropic.com` is used "only for tier 2, only when you have saved a key, and only when local parsing is uncertain".
- `src/content/index.ts:22`: the threshold comment.
- **No documented constraint limits the number of Claude calls per page view**; the code structure makes at most one call per `run()` (`src/content/index.ts:207-213`). `CHANGELOG.md:20` notes only model/effort configurability.

## Reference points

**Q13 — Most representative caller.**
`tests/sites.test.ts:79-90`. Pattern: `const graded = gradeByTier(recipe, raw)`, then per-tier assertions mapping findings to `` `${f.rule}: ${f.detail}` `` strings and expecting `[]` — S and F gated together in one test ("is structurally sound and faithful to the source recipe"), L in a separate test ("is legible"), so failures print rule id + detail.

**Q14 — Documented relationship between `grade.ts` and the pipeline.**
- `src/core/grade.ts:1-19` header: layout proves a card can be *drawn*; grading proves it is *true*; the grader deliberately shares vocabulary but not judgement with inference ("A grader that reused the inference's reasoning would only agree with itself").
- `docs/recipe-card-rules.md:162-164`: `Recipe.confidence` is a rough proxy for F1 only, not the grade; `:180-189`: `gradeCard` runs against the 15 site fixtures via `tests/sites.test.ts`; `:240-243`: the fixture suite would previously pass even if operations attached to the wrong ingredients.
- `src/core/infer.ts:18-19`: confidence exists "so the caller can escalate to the Claude fallback or drop to a flat table" (the source of the "escalation" vocabulary).
- README does not mention grading at all (grep for "grade" in `README.md`: no matches).

**Q15 — Other places comparing two `Recipe` values.**
Exactly one: `src/content/index.ts:211` (`viaClaude.root && viaClaude.confidence >= recipe.confidence`). `src/core/infer.ts` never compares two `Recipe` values — `inferTree` and `flatTree` each construct one independently. The `flatTree` substitution at `src/content/index.ts:215` is an unconditional replacement when `recipe.root` is null, not a comparison.

## Open Questions
None — every question was answerable from the codebase.
