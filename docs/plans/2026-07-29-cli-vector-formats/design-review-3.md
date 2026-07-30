---
topic: 2026-07-29-cli-vector-formats
date: 2026-07-29
phase: design-review
verdict: REQUEST CHANGES
---

# Design review — round 3

Reviewer: fresh-context read-only `Explore` subagent. Findings verbatim.

---

## Round 1 and round 2 blocking findings — status

| Round | Finding | Status | Evidence |
|---|---|---|---|
| 1.1 | Shrink loop cannot be a straight port with two floors | **Resolved** | Decision 10 (`design.md:222-242`) states a new rule, proves it terminates, and the geometry test (`:386-390`) has the case the ported loop fails. |
| 1.2 | 0.6 em fallback under-measures `…` | **Resolved** | Fallback is now 1.0 em and `…`/`—` are in the table at 1000 (`:117-118`); I measured both at 1000 in Arial's `hmtx`. |
| 1.3 | `overlay.css:26` misattributed | **Resolved** | Decision 11 (`:243-263`) now says plainly the browser has no table cap and 1180 is the CLI's own target. |
| 1.4 | Exit code lumps "not installed" with "will not load" | **Resolved** | Decision 7 (`:173-196`) splits the codes, strips the reason, and adds the reinstall hint. |
| 1.5 | Smoke test proves nothing about resvg | **Resolved** | `:423-427` runs the built bundle with `--format png`. |
| 1.6 | Assertions prove well-formedness, not placement | **Resolved** | `:391-400` asserts `y_pdf = H − y_svg` as a computed relation, picks the line by text, and keeps one hand-computed anchor. |
| 1.7 | SKILL.md and README.md not in scope | **Resolved** | `:74-79` names both with line refs; I checked `SKILL.md:26`, `:36-41`, `README.md:71-75` and all say what the doc claims. |
| 2.A | Table can exceed 1180 and the doc never says so | **Resolved** | Decision 11 says the floors win, gives 1254px at 13 columns, and Edge cases (`:341-346`) and the geometry test (`:388-390`) now agree. Arithmetic checks: `246 + 84×(n−1)` gives 1170 at 12, 1254 at 13, 42,246 at 501. |
| 2.B | 16,384 per-side clamp is not a memory bound | **Resolved** | Decision 13 (`:275-278`) switches to an area clamp. The math is right: 64 × 2²⁰ = 67,108,864 px, × 4 B = 268,435,456 B ≈ 268 MB, and `s = sqrt(MAX/(w·h))` lands the output on exactly `MAX`. |

Round 2's non-blocking items all landed too: the dead `flatTree:478` citation is
replaced by `:311`, `:369`, `:494` (all three verified reachable), pagination is now
a named rejected alternative *and* in Out of scope, the 1 em ceiling is scoped to
PDF, the borders are in the floor derivation, `renderPng` has a signature, the drift
test asserts an exact string, and the USAGE remedy line is stated.

The one round-2 item that did **not** land cleanly is the new width table.

---

## Findings

**issue (blocking):** The three fraction widths are wrong, and they break decision
3's own safety rule.

The table adds `½ ¼ ¾` at 556 em-units. Their real advance is **834**. I read the
advances straight out of `/System/Library/Fonts/Supplemental/Arial.ttf` — the same
metric family decision 4 leans on — scaled to 1000 units per em:

```
endash 556   emdash 1000   ellipsis 1000
quoteright 222   quoteleft 222
quotedblleft 333   quotedblright 333   degree 400
onehalf 834   onequarter 834   threequarters 834
```

Every other new number matches the doc exactly, which is good evidence the
measurement is sound. The fractions do not. 834 − 556 = 278/1000 em, so each one is
measured **4.17px short at 15px**.

Two things make this worse than a stray constant.

First, it breaks the invariant the decision states two lines below: "the fallback
never under-measures text the PDF can encode" (`design.md:129`). I checked that
claim across the whole non-ASCII CP1252 set and it holds — nothing exceeds 1000. So
the 1.0 em fallback was already **safe** for `½ ¼ ¾`. Hand-adding 556 makes those
three glyphs worse than leaving them out.

Second, the exposed path is common. `normalizeText` (`src/core/units.ts:243-253`)
turns `½` into `1/2`, but decision 16 already establishes it runs only on ingredient
lines (`ingredient.ts:83`). Banner and op cells come from raw step text, so "Bake 1½
hours" keeps the glyph. Under-measuring eats the 10px cell padding and, with two or
three fractions on one line, pushes text past the border — the same overflow round 1
blocked on for `…`.

The fix is one number. Please also widen decision 4's one-time `hmtx` check to cover
the twelve non-ASCII entries, not just the 95 ASCII ones — as written, the doc's own
safety net would not have caught this.
file: `design.md:118`

**suggestion (non-blocking):** The reverse water-fill needs one more sentence about
leftover pixels, or "same widths" is not quite true.

The equivalence itself holds. The loop's fixpoint is
`width_i = max(floor_i, min(natural_i, L))` for one level `L`, which is what a
floor-aware reverse water-fill computes. A column that is already at its floor is
skipped by the loop and pinned by the `max(floor_i, …)` term, so the two agree.
Termination and the "no column above its floor" case are both covered. Good.

What is missing is the last step. The per-pixel loop stops the instant the total hits
the target, so it lands on the target **exactly**, and it leaves some columns at `L`
and some at `L+1`. A water-fill that computes `L` and sets every active column to `L`
will land *under* the target instead — by up to one pixel per active column.
Shrinking only happens when the floor sum is below 1180, which means at most 12
columns, so the gap is at most about 11px. Small, but it is a silent difference from
the rule the doc calls "the specification".

One clause fixes it: say the leftover pixels are handed back to the widest columns
(lowest index first, matching `render-text.ts:88`), so the final width equals the
target.
file: `design.md:235`

**suggestion (non-blocking):** Say why there is no floor on `s`, so nobody adds one
later.

The clamp arithmetic is right and the alternative is honestly named. What is not
discussed is how small `s` can get. Work the doc's own worst case: 501 columns is
42,246px wide, and 500 ingredient rows at roughly 42px each is about 21,000px tall.
That is 887 Mpx, so `s = sqrt(67.1/887) ≈ 0.28`. The 15px text lands at about 4px —
a gray smudge, though an honest one, since the advisory reports the scale.

I think no floor is the right call: the only other options are refusing to render
(worse for scripts) or blowing the memory bound. But the doc should say that out
loud. As written, an implementer could reasonably add a floor and quietly break the
memory guarantee.

While you are there, the "~17,500px tall" figure at `:295` implies 35px per row. A
single-line row is closer to 42px once `lineHeight = 15 × 1.35`, `PAD × 2`, and the
2px border are added, and op columns at their 82px floor will wrap most labels onto
two or three lines. The conclusion does not change — it still lands in the advisory
path — but the number understates it.
file: `design.md:277`

**nitpick (non-blocking):** Two citations are off by a few lines.

`external: ['jsdom']` is at `build.mjs:55`; line 56 is the closing `},`. The doc says
`build.mjs:56` here, again at `:163`, and the range `:47-56` at `:98`.
(`research.md:202` has the same slip, so it was inherited, not invented.)

Separately, the guarded render block's `try` opens at `run.ts:173` and closes at
`:219`; `:165-171` is the comment above it. The doc cites `run.ts:166-219` at
`design.md:362`, which points into the middle of a comment sentence.

Everything else I spot-checked resolves and says what the doc claims:
`infer.ts:204-207`, `:311`, `:369`, `:494`, `:501`; `layout.ts:7`; `extract.ts:26`
and `:36-40`; `overlay.css:4-6`, `:18`, `:26`, `:116-119`, `:123-127`, `:139`,
`:150-159`; `image.ts:13-15`, `:49-66`, `:74`, `:88-99`, `:108-114`, `:117-146`,
`:127-139`, `:136`, `:150`; `render-text.ts:27-64`, `:67-93`, `:77-84`, `:86`,
`:87-91`, `:96-100`, `:125-137`, `:141-148`; `args.ts:12-14`, `:35`;
`index.ts:19-23`, `:41`; `ci.yml:15-17`; `smoke.test.ts:74-88`; `SKILL.md:26`,
`:36-41`; `README.md:54-57`, `:71-75`.
file: `design.md:71`

**nitpick (non-blocking):** `FORMATS` is module-private today.

`src/cli/args.ts:14` declares `const FORMATS`, not `export const FORMATS`. The drift
test wants to import it. One clause in Desired end state ("`args.ts` exports
`FORMATS`") keeps the implementer from having to guess whether widening the export is
in scope.
file: `design.md:433`

---

## Template and scope

Every section of the house template is present and none reads thin. Edge cases still
walks all six categories, and the two boundaries round 2 asked for — floors-win and
the area clamp — are now in it rather than only in Decisions.

Decision quality is high. All seventeen decisions name an alternative with a real
reason, and the reasoning reconstructs from the cited files in every case I traced.
Decision 13, which round 2 called the weak one, now has two named alternatives and
correct arithmetic.

I looked hard for contradictions left by three rounds of edits and found only the one
in the blocking finding. The floors-win change is carried through consistently:
decision 11, decision 13's justification for the area clamp, Edge cases, Resource
limits, both geometry test cases, the PDF MediaBox invariant, the PDF test, and the
Risks entry all agree on 1254px at 13 columns and ~42,246px at the extraction
ceiling, and I re-derived each number.

Scope discipline is good. Every new module, the font asset, the optional native
dependency, and both document changes trace to the stated feature. Out of scope is
concrete and now includes pagination.

**REQUEST CHANGES**
