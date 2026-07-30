---
topic: 2026-07-29-cli-vector-formats
date: 2026-07-29
phase: design-review
verdict: APPROVE
---

# Design review — round 4 (final)

Reviewer: fresh-context read-only `Explore` subagent. Findings verbatim.
The reviewer parsed `Arial.ttf`'s `hmtx` itself to check the font numbers.

---

## Round 3 findings — status

| # | Round-3 finding | Status | Evidence |
|---|---|---|---|
| Blocking | `½ ¼ ¾` listed at 556; real advance is 834 | **Resolved** | `design.md:120` now reads 834. Measured from `/System/Library/Fonts/Supplemental/Arial.ttf` with a stdlib `cmap`/`hmtx` parse: onehalf 834.0, onequarter 834.0, threequarters 834.0. `–` correctly stayed at **556** (measured 556.2). Every other entry matches: `—` 1000, `…` 1000, `’`/`‘` 222, `“`/`”` 333, `°` 400. |
| Blocking (part 2) | Widen the `hmtx` task past the 95 ASCII entries | **Resolved** | `:147-150` says compare every entry, "the 95 ASCII advances and the eleven non-ASCII ones alike", and states why an ASCII-only check would miss exactly this bug. |
| Suggestion | Leftover pixels after leveling to one integer `L` | **Resolved** | `:246-249` hands leftovers back "to the widest columns, lowest index first (the `render-text.ts:88` order)". Verified `render-text.ts:88` is `widths.indexOf(Math.max(...widths))` — lowest-index-first. The ≤ ~11px bound is right: at most 12 active columns, at most `active − 1` at `L+1`. |
| Suggestion | Say why `s` has no floor; fix "~17,500px tall" | **Resolved** (one wrinkle) | `:299-306` states the no-floor choice; `:315-317` says ~21,000px and derives ~42px/row (15 × 1.35 = 20.25, + `PAD × 2` = 20, + 2px border = 42.25). |
| Nitpick | `build.mjs:55`, `run.ts:173-219`, `args.ts` exports `FORMATS` | **Resolved** | All three verified against source. |

## The eleven-vs-twelve count — the author is right

I checked `extract.ts:36-40` byte by byte. `nbsp: ' '` is stored as `27 20 27` — a
plain ASCII space (U+0020), not U+00A0. So the entity table's non-ASCII values are
exactly `– — … ’ ‘ “ ” ° ½ ¼ ¾`, which is **eleven**. `bannerText` (`infer.ts:207`)
appends `…`, already in that set. Round 3's "twelve" was the error, not the doc.
Keep eleven.

## Template, citations, contradictions

Every template section is present, plus a problem statement and a Testing strategy.
None reads thin. Edge cases walks all six categories.

Citations re-checked and confirmed: `build.mjs:55`; `run.ts:6-8`, `:56-58`,
`:60-70`, `:76-81`, `:124`, `:141-147`, `:161`, `:173-219`, `:178-181`, `:197`,
`:203-207`, `:210-215`, `:217`; `args.ts:12-14`, `:14`, `:35`; `index.ts:19-23`,
`:41`; `render-text.ts:67-93`, `:77-84`, `:86`, `:87-91`, `:88`, `:96-100`;
`extract.ts:26`, `:36-40`; `infer.ts:204-207`, `:311`, `:369`, `:494`, `:501`;
`layout.ts:7`; `ingredient.ts:83`; `ci.yml:15-17`, `:17`; `SKILL.md:26`, `:36-41`;
`README.md:54-57`, `:71-75`. Floor arithmetic re-derives: `246 + 84×(n−1)` gives
1170 at 12, 1254 at 13, 42,246 at 501.

**Test (a) asserting exactly 1180px is consistent.** The leftover-pixel handback is
what makes the shrink path land on the target instead of under it; and floors-win
never fires at ≤12 columns, because the floor sum there is at most 1170. Floors-win
starts at 13 columns, which is test (b). The cases do not overlap.

---

## Findings — all non-blocking, carry into implementation

**suggestion:** The "no lower floor" paragraph is filed under the PDF scale but
argues the PNG case, and its number is the PNG number. `s ≈ 0.28` is
`sqrt(67.1/887)`, the PNG area clamp; the PDF scale at the same ceiling is
`14400 / 42246 ≈ 0.34`, and 15px text lands near 5px, not 4px. The closing reason
("letting the buffer break the memory bound") is the PNG RGBA buffer, which the PDF
path does not have. The rule is right for both, but a reader tracing the arithmetic
will stall. Split into one sentence per format, or name the scales apart
(`s_png`, `s_pdf`).
file: `design.md:299`

**suggestion:** The width table's unit is stated two ways in one sentence. The 95
ASCII widths are described as "at 15px" and the eleven non-ASCII ones as em-units.
Two units in one table is the kind of thing that produces a 15× or 1/15 bug on the
first run. One clause — "all widths are stored in 1000-unit em space; `textWidth`
multiplies by `fontSize / 1000`" — removes the guess.
file: `design.md:118`

**suggestion:** The seam the resvg tests stub is not named. Decision 7 puts the load
check in `run()` before the fetch, but the lazy `await import()` lives in
`src/cli/render-png.ts`. The testing strategy says the failure messages are
"unit-tested by stubbing a `loadResvg()` indirection" without saying where
`loadResvg` lives or how the stub gets in. The doc's own precedent is injection
through `RunDeps` (`run.ts:60-70`), the same route decision 8 uses for
`stdoutIsTTY`. One clause picking that route saves an awkward-to-undo guess.
file: `design.md:439`

**suggestion:** Accented Latin letters are a plausible fourth table entry. `é`
measures 556 in Arial — same as `e`. The 1.0 em fallback over-measures by 1.8×,
about 6.7px per letter at 15px. The repo's own verb lists carry `sauté` and `purée`
(`infer.ts:108`, `:111`), so accented step text is realistic. This is padding, never
overflow, so it is optional. Recording the choice either way would close it.
file: `design.md:130`

**nitpick:** "Shrinking only happens below the 13-column floor sum" is not literally
true — shrinking happens at 13+ columns too, it just stops at the floors. What is
true is that *undershooting the target* only happens when the target is reachable,
which needs ≤12 columns. Reword to keep the ≤ ~11px bound and drop the false claim.
file: `design.md:245`

**nitpick:** The `build.mjs` range now starts mid-comment. The jsdom comment runs
`:45-47` and the CLI config object `:48-55`; the doc's `:46-55` starts on the second
line of the comment. `45-55` or `48-55` lands clean. Inherited from round 3's fix,
which corrected the end and shifted the start.
file: `design.md:99`

**nitpick:** Geometry test (a) needs one word about its fixture. "Assert the table
shrinks to exactly 1180px" only proves something if the grid's *natural* width starts
above 1180. Add "whose natural width exceeds 1180px" to the case description.
file: `design.md:409`

**nitpick:** Decision 3 credits `°` to entity decoding only. It is also synthesized
at `infer.ts:185-187` (`${f}°F (${toCelsius(f)}°C)`). The set does not change — `°`
is already in the table at 400 — but the provenance sentence undersells why it
belongs. Note only.
file: `design.md:121`

**nitpick:** The doc is 492 lines against a ~200-line target. Four rounds of demanded
precision did this and every sentence earns its place, so no rewrite now. Carry
forward: decision 13 alone is 32 lines covering two different scale rules, which is
part of why the PDF/PNG mix-up above was easy to make. A future split into "PNG area
clamp" and "PDF page scale" would help the next reader.
file: `design.md:1`

---

## Scope and standards

Scope discipline holds. Every new module, the font asset, the optional native
dependency, and both document changes trace to the stated feature. Out of scope is
concrete and names the tempting adjacent work (`--out`, pagination, golden
screenshots, font embedding). All seventeen decisions name a real alternative with a
real reason, and every self-resolved one is marked as an assumption.

Against the engineering-standards lens: the pure core / imperative shell split is
explicit and enforced by module placement (`src/core/*` stays DOM-free, the native
dependency lives only in `src/cli/`). Failures are actionable — exit 2 and exit 1 are
split by cause, each with a remedy, and untrusted text goes through `stripControls`.
No magic numbers survive unexplained; 1180, 240/82, 64 Mpx, 14,400pt, and 2× each
carry a derivation.

Nothing I found would cause rework or a user-visible defect if built as written. The
nine items above are wording and precision, and can be carried as notes into
implementation rather than blocking another round.

**APPROVE**
