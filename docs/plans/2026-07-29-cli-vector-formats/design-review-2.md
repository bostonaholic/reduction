---
topic: 2026-07-29-cli-vector-formats
date: 2026-07-29
phase: design-review
verdict: REQUEST CHANGES
---

# Design review — round 2

Reviewer: fresh-context read-only `Explore` subagent. Findings verbatim.

---

## Round 1 findings — status

| # | Round-1 finding | Status | Evidence |
|---|---|---|---|
| 1 | Shrink loop cannot be a straight port with two floors | **Partly resolved** | Decision 10 (`design.md:200-211`) re-derives the rule and the geometry test (`:316-318`) covers the named case, but the loop still cannot hold the cap when every column sits at its floor — see Finding A. |
| 2 | 0.6 em fallback under-measures `…` | **Resolved** | Decision 3 (`:113-121`) raises the fallback to 1.0 em and adds `…`/`—` at 1000 and `–` at 556; I confirmed those three Helvetica AFM values. |
| 3 | `overlay.css:26` misattributed | **Resolved** | Decision 11 (`:212-221`) now says the cap is the CLI's own rule; `overlay.css:26` is `max-width: min(1180px, 100%)` on `.rd-panel`, `:116-119` is `.rd-scroll`, `:123-127` is `.rd-table` — all three read as claimed. |
| 4 | Exit code lumps "not installed" with "will not load" | **Resolved** | Decision 7 (`:162-175`) splits the codes and routes the reason through `stripControls`, matching `run.ts:124`. One residual gap in Finding H. |
| 5 | Smoke test proves nothing about resvg | **Resolved** | `:345-350` runs `--format png` through the built bundle; `ci.yml:15-17` is ubuntu-only as claimed, and that limit is now in Risks (`:379-381`). |
| 6 | Assertions prove well-formedness, not placement | **Resolved** | `:319-323` adds the literal SVG `x`/`y` plus PDF `Tm` check with `y_pdf = H − y_svg`. That relation does pin the flip. Brittleness noted in Finding G. |
| 7 | SKILL.md and README.md not in scope | **Resolved** | `:71-77` adds both with exact line refs; `SKILL.md:26`, `:36-41`, `README.md:71-75` all say what the doc claims, and `:351-354` adds a drift test. |

**Suggestions:** font-family stack — resolved (decision 12). Oversize caps and
advisory — resolved (decision 13), but see Finding B. Metric chain as assumption —
resolved (decision 4 plus the `hmtx` task). `normalizeText` one path — resolved;
`ingredient.ts:83` is the only call site in `src/`. 240/82 floors — resolved; see
nitpick J. Problem statement — resolved (`:10-17`).

---

## New findings

**issue (blocking):** The table can still be wider than 1180px, and the doc never
says what happens then.

Decision 10 fixed early stopping. It did not fix the case where *every* column is
already at its floor. Do the arithmetic with the doc's own numbers:
`240 + 82×(n−1)` plus `2px` interior borders plus a `3px` frame each side. At 12
columns that is 1170px — fits. At 13 columns it is 1254px — over the cap, with
nothing left to shrink.

13 columns is ordinary, not hostile. `layout.ts:7` sets
`column(node) = depth from the ingredient leaves`, and `flatTree` wraps one op per
step (`infer.ts:501`), so a 12-step recipe gives 13 columns. `extract.ts:26` caps
steps at 500, so the ceiling is ~501 columns and a ~41,000px table.

Three things break. Decision 11 (`design.md:212`) states the cap as a fact. The
geometry test (`:317`) asserts `≤ 1180`, which the algorithm cannot deliver. And
Edge cases (`:284-288`) never lists this boundary. Say plainly what wins — the
floors or the cap — and put it in Edge cases.
file: `design.md:212`

**issue (blocking):** The 16,384 clamp bounds each dimension separately, so the
memory number it is chosen for is wrong.

`design.md:236` says the raster is "~155 MB worst case at our width cap". That math
only works if width really stops at 1180. Two dimensions each clamped at 16,384
gives `16384 × 16384 × 4 = 1.07 GB` — about 7× the stated bound. Finding A shows
the width cap is not guaranteed, so this is reachable, not theoretical.

The number 16,384 is the only justification decision 13 offers, and it is also the
one decision in the doc with no named alternative. Bound the total pixel count
instead of each side, or state the real worst case. This is a resource-limit
contract, so it belongs in Edge cases too — `:303-306` currently says oversize
rasters "are clamped", which reads as safe.
file: `design.md:233`

**issue (non-blocking):** The `flatTree` citation points at dead code.

Decision 3 says `flatTree` (`infer.ts:478`) "routes every step through"
`bannerText`. Line 478 does call `.map(bannerText)` — but it sits inside the
`nodes.length === 0` branch (`infer.ts:475-486`), which returns `root: null`. The
doc's own Edge-cases citation, `run.ts:203-207`, then exits 1. Nothing from that
branch is ever rendered.

To answer the question directly: `bannerText` at `infer.ts:204-207` is right, the
`…` is emitted at `:207`, and `extract.ts:38` really does decode `–`, `—`, and `…`.
The reachable callers are `infer.ts:311`, `:369`, and `:494`. Swap the citation.
The decision itself does not change.
file: `design.md:117`

**issue (non-blocking):** PDF pagination is never decided or ruled out.

Decision 13 shrinks a tall drawing with a uniform scale so it fits inside 14,400pt.
So a 500-row recipe becomes one enormous page at roughly 0.35× — small enough to be
hard to read. Paginating is the obvious alternative and is what a reader expects a
PDF to do. It is not in Decisions and not in Out of scope (`:267-280`). Name it in
one place or the other.
file: `design.md:238`

**suggestion:** The 1.0 em ceiling is a PDF guarantee, not an SVG or PNG one.

The AFM claim holds. In Helvetica no non-ASCII WinAnsi glyph goes past 1000/1000 —
`ellipsis`, `emdash`, `perthousand`, `trademark`, `AE`, and `OE` all sit exactly
there. So the wording "never under-measures text the PDF can encode" is careful and
correct.

But decision 16 (`:255-261`) says SVG and PNG carry full Unicode. There the ceiling
does not apply. An emoji is often wider than 1 em in the font a viewer picks, so the
box overflows again — the same bug round 1 caught, just on a narrower path. One
sentence saying the guarantee stops at the PDF, and that SVG/PNG accept the
overflow, would close it.
file: `design.md:119`

**suggestion:** The fallback over-measures the most common non-ASCII character in
recipe text.

`extract.ts:38` decodes `’` from `&rsquo;`, and page text carries it directly too.
Its real Helvetica width is 222/1000 — the fallback measures it at 1000. That is
about 11.7px of phantom width per apostrophe, in words like "don't" and "chef's"
that appear in almost every recipe. Columns come out wider than they should, which
pushes more work onto the shrink loop from Finding A.

The doc already added three code points by hand. Adding `’ ‘ “ ” °` — the rest of
what `extract.ts:38-39` can emit — costs five more integers.
file: `design.md:119`

**suggestion:** Literal `x`/`y` assertions will break on harmless changes.

The relation `y_pdf = H − y_svg` is the part that pins the flip, and it is worth
keeping. The literal numbers are not. `PAD`, the 15px size, the 1.35 line height,
and the `0.82` baseline factor all feed those values. Change any one and the test
fails even though nothing is wrong. That is a change-detector test.

Two smaller fixes: assert the relation as a computed comparison and keep only one
hand-computed anchor value; and pick the `<text>` by its content, not by being
first. `image.ts:127-139` emits all rects before all texts, so "first" is an
accident of iteration order, not a contract.
file: `design.md:319`

**suggestion:** The exit-1 branch leaves the user with no next step.

`ERR_MODULE_NOT_FOUND` is reliable for a missing package, and guarding on the
specifier name is the right care. But the realistic corrupt install is not that
case. When `npm ci` runs against a lockfile built on another OS, the platform
binary package is missing while `@resvg/resvg-js` itself is present. Its loader
throws a plain `Failed to load native binding` — so it lands on exit 1, per the
doc's rule.

The catch is that the *same reinstall* fixes it. So the user gets exit 1 and a bare
five-word error with no remedy, for a problem the exit-2 remedy line would have
solved. Either let the exit-1 line carry a short "try reinstalling" hint, or say why
it should not.
file: `design.md:168`

**suggestion:** State that the new shrink loop terminates, and what it costs.

It does terminate: each pass drops one column by 1px, the total strictly falls, and
the set of columns above their floor never grows. Worth one clause, since the whole
decision is about a loop that used to stop too early.

The cost is the part that changed. In character units the loop ran at most a few
hundred times. In pixels it runs once per pixel of overshoot, and recomputes
`Math.max(...widths)` every pass (`render-text.ts:88`). A wide grid gives hundreds
of thousands of passes over hundreds of columns. `:278` claims a "~2 ms render",
which this could break on the input Finding A describes.
file: `design.md:200`

**nitpick:** The floor derivation skips the borders.

`:192-194` says the rendered cell "is 20px wider" once `padding: 7px 10px` applies.
In the browser it is 24px wider — `overlay.css:139` adds `border: 2px solid` on each
side too. The derived floors of 240 and 82 are still right, because the doc's model
keeps borders as separate terms, the way `render-text.ts:86` does. Say that in the
sentence so the arithmetic reconstructs.
file: `design.md:192`

**nitpick:** `render-png.ts` has no stated signature.

`renderSvg(grid): string` and `renderPdf(grid): { bytes, scale }` are exact. The png
renderer gets only a description (`:59-62`). But decision 13 says "the renderers
report the applied scale to `run()`", which is a contract the png arm has to satisfy
too. One signature closes it.
file: `design.md:59`

**nitpick:** The drift test asserts the weak thing.

"Lists every member of `FORMATS`" passes on a substring match, and `text` already
appears in the Skill's prose. What actually drifts is the invoke line at
`SKILL.md:26`. Assert the exact `--format ${FORMATS.join('|')}` string instead.
file: `design.md:352`

**nitpick:** Exit 2 for a missing module stretches the documented meaning of exit 2.

`args.ts:35` and `run.ts:6-8` both call 2 a "usage error". Here the command line is
perfectly valid and the fix is a reinstall. The reasoning in decision 7 is fair —
the remedy is in the environment, no work has begun — and it matches the `--claude`
precedent at `run.ts:77-81`. The doc says `USAGE` is updated but not that this line
is part of the update. Say so.
file: `design.md:164`

---

## Template and scope

Every template section is present and none is thin. Edge cases still covers all six
categories, though Findings A and B belong in it. Out of scope is concrete; the only
gap is PDF pagination (Finding D). Open questions are properly deferred, and the
"Assumption — chosen without user review" tags are used consistently. Scope
discipline is good — every new module, the font asset, and both doc changes trace to
the stated feature, and nothing from the stacked branch is redone.

Decision quality is high. Fifteen of seventeen decisions name an alternative with an
honest reason. Decision 13 is the weak one: two magic numbers, no alternative, and
the memory figure that justifies one of them is wrong (Finding B).

**REQUEST CHANGES**
