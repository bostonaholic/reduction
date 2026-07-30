---
topic: 2026-07-29-cli-vector-formats
date: 2026-07-29
phase: design-review
verdict: REQUEST CHANGES
---

# Design review — round 1

Reviewer: fresh-context read-only `Explore` subagent. Findings verbatim.

---

**issue (blocking):** "Port, do not redesign" cannot hold for the shrink loop once
there are two different column floors. `render-text.ts:87-91` reads:

```js
while (total() > width) {
  const widest = widths.indexOf(Math.max(...widths));
  if (widths[widest] <= MIN_COL_WIDTH) break; // Nothing left to squeeze.
  widths[widest]--;
}
```

That `break` is only safe because `MIN_COL_WIDTH` is one global number. When the
widest column is at the floor, every column is at the floor, so stopping is right.
Decision 9 gives column 0 a floor of 220 and the rest a floor of 62. Now the
widest column can sit at its own floor while other columns still have 150px of
room each, and the loop quits early with the table still over the cap. This is not
a rare case: `infer.ts:207` clips operation labels at 90 characters, so natural
op-column widths run into the hundreds of pixels and the shrink loop is the main
path for any real recipe. The design needs to say the loop is re-derived for
per-column floors (pick the widest column *that is still above its own floor*;
stop only when none is), and the geometry test needs a case that proves it.
file: `design.md:64`

**issue (blocking):** The 0.6 em fallback is not generous, and the pipeline itself
produces a character that proves it. `infer.ts:207` appends U+2026 (`…`) to every
operation label longer than 90 characters. `…` is outside ASCII 32–126, so the
table measures it at 0.6 em = 9px. Its real advance in Helvetica, Arial, and
Liberation Sans is 1.0 em = 15px. The em dash is the same. So a wrapped line that
the layout thinks fits will run past the edge of its box — in the SVG, in the PNG,
and in the PDF (`…` is in WinAnsi at 0x85, so it renders rather than becoming
`?`). The claim "slightly generous, so boxes pad rather than clip" is false for the
exact glyph the code manufactures on a common path. Either raise the fallback above
1.0 em, or add the handful of wide code points the pipeline can emit (`…`, `—`,
`–`) to the table as real widths.
file: `design.md:93`

**issue (blocking):** The `overlay.css:26` citation does not say what the doc
claims. Line 26 is `max-width: min(1180px, 100%)` on `.rd-panel` — the dialog
shell, not the table. `.rd-scroll` (`overlay.css:116-119`) adds `22px` of
horizontal padding and `overflow-x: auto`, and `.rd-table` (`:123-127`) is
`width: 100%`. Two things follow. First, the widest a table ever gets in the
browser is about 1136px, not 1180px. Second, the browser has no cap at all — when
the content needs more room the table overflows and the panel scrolls sideways. So
"table width caps at 1180px (`overlay.css:26`)" is not a fidelity match; it is a
new rule the CLI is inventing. Inventing it is fine, but it should be recorded as a
choice with its own reason, not presented as copying the CSS.
file: `design.md:143`

**issue (blocking):** Decision 7 treats "resvg is not installed" and "resvg fails
to load" as one thing. They are not. An optional native module can also be present
but built for the wrong Node ABI, or half-written by an interrupted install.
`await import()` throws in all three cases, but the prescribed remedy ("reinstall
without `--omit=optional`") only helps the first one, and an ABI mismatch is an
operational failure of the environment, not a usage error the caller can fix by
changing the command. The design should either narrow exit 2 to the
module-not-found case and send load failures to exit 1, or state plainly why one
code covers both. The decision also does not say what happens to the underlying
error text. Every other untrusted string in `run.ts` goes through `stripControls`
(`run.ts:124`, `:161`, `:197`, `:217`), and the file's comments are explicit about
never dumping a stack with local paths (`run.ts:141-147`). A native load error
carries absolute paths. Say whether the reason is included, and if so that it is
stripped.
file: `design.md:121`

**issue (blocking):** The smoke test as described cannot prove what it claims.
`--format svg` never imports `@resvg/resvg-js` and never opens the font file, so
running the built bundle with `--format svg` exercises exactly the jsdom external
that is already covered today. The new external is untested end to end. Worse,
decision 5 — resolving the font from the repo through
`new URL('../assets/fonts/…', import.meta.url)` — is named in the doc's own Risks
list, and nothing in the test plan runs it from the built `dist/cli.mjs`. The
unit-level PNG test imports source, not the bundle, so it will pass even if the
bundled path is wrong. The smoke test should run `--format png` against the local
test server and assert PNG magic bytes. Related: the `unit` job in
`.github/workflows/ci.yml` runs on `ubuntu-latest` only, so the claim
"deterministic across CI OSes" (`design.md:242`) is never exercised on macOS by any
job that runs the unit suite.
file: `design.md:246`

**issue (blocking):** The proposed assertions prove the files are well-formed, not
that the drawing is in the right place. Walk them: the SVG test parses with jsdom
and counts elements and checks root width and height; the PDF test checks the
header, `%%EOF`, xref offsets, MediaBox, and that text appears somewhere in the
bytes; the PNG test checks magic bytes, IHDR, and an ink floor. A bug in the
baseline math (`top + fontSize * 0.82`), a wrong text anchor, or a flipped sign in
the PDF y-flip passes every one of those. The PDF y-flip is the single most likely
coordinate bug in the whole design, and nothing checks it. This is cheap to close
without a pixel-diff library: for one small fixed grid, assert the literal `x`/`y`
on the first `<text>` in the SVG, and assert the `Tm` numbers for the same cell in
the PDF. That also pins the claim that all three formats come from one engine,
which nothing currently tests.
file: `design.md:226`

**issue (blocking):** Two user-facing documents list the format set and neither is
in scope. `.claude/skills/reduction/SKILL.md:26` says `[--format text|json|html]`
and lines 36-40 describe each one; `README.md` does the same in its "Command line"
section. Decision 8 rejects an `--out` flag partly because "shell redirection
already does the job for the real users (scripts and the agent Skill)" — so the
agent Skill is load-bearing for that decision, yet the Skill is never told the new
formats exist or that png and pdf must be redirected. `tests/cli/skill.test.ts`
does not assert the format list, so nothing will catch the drift. Add both files to
the change list.
file: `design.md:57`

**suggestion (non-blocking):** The `font-family` value the new `renderSvg` writes
is never stated, and it is the hinge of the whole metric argument for anyone who
opens the SVG outside resvg. `image.ts:136` emits whatever `getComputedStyle`
returned, which in the extension is `"Helvetica Neue", Helvetica, Arial,
sans-serif` (`overlay.css:18`). If the CLI copies that string, a reader on a Linux
box with none of those faces falls back to DejaVu Sans, which is noticeably wider
than Helvetica and will push text out of the boxes the layout drew. If it emits
`Liberation Sans` instead, macOS users get their own fallback. Pick a stack, write
it in the design, and say which face each documented path actually resolves. The
Risks section covers this exposure for PDF viewers but not for SVG viewers, and SVG
is the format the design says prints anywhere.
file: `design.md:47`

**suggestion (non-blocking):** Decision 12 has two unsourced numbers and one
internal contradiction. 16,384 is a browser canvas limit; resvg is Rust and has no
such limit, so the real reason must be memory, and the doc should say that. There
is also no floor on the clamped scale: for the documented worst case (a 500-row
capped recipe, roughly 17,500px tall at 1×) the clamp drops the scale *below* 1×,
so a capped recipe silently ships a shrunken image with no word to the user — even
though `run.ts:178-181` establishes exactly the advisory-stderr habit that fits
here. Same for the PDF: if a uniform scale shrinks the drawing to fit 14,400pt, the
MediaBox no longer equals the geometry, which contradicts the PDF test's stated
invariant "MediaBox equals geometry" (`design.md:234`). Neither oversize path
appears in the test list.
file: `design.md:158`

**suggestion (non-blocking):** The metric chain is stronger than the doc's phrasing
admits inside ASCII 32–126 and weaker outside it, and the difference is worth
writing down. Inside the range, research measured the table against pdfkit's
Helvetica AFM and got exact agreement (`research.md:172-178`), and Arial was built
as a width-for-width Helvetica substitute, so the SVG-to-PDF half of the chain is
verified. The Arial-to-Liberation half is not: nobody measured the shipped TTF.
Every other number in `research.md` came from a real measurement, so this one link
stands out as inherited belief. The PNG ink-count test will not catch a width
mismatch — ink appears either way. Record it as an assumption, and note the one-time
check (read `hmtx` from the shipped file once and compare 95 numbers) as an
implementation task rather than a runtime parser, which decision 3 rightly rejects.
file: `design.md:97`

**suggestion (non-blocking):** "The pipeline normalizes unicode fractions" is true
for one path only. `normalizeText` is called in exactly one place in `src/`:
`ingredient.ts:83`. Operation labels and banner text never pass through it, so `⅓`,
`⅔`, and `⅛` survive into op and banner cells. Those three are not in CP1252, so
they become `?` in the PDF. `½`, `¼`, and `¾` are in CP1252 and survive. The
decision to print a visible `?` is still the right call, but the reason given for
why it will rarely fire is overstated, and a future reader will trust it.
file: `design.md:163`

**suggestion (non-blocking):** The 220px and 62px floors are CSS `min-width` values
on `td` elements. With `:host { all: initial }` (`overlay.css:4-6`) the box model is
`content-box`, so in the browser those are *content* widths and the cell is 20px
wider than the number once `padding: 7px 10px` is added. Used directly as column
floors in a model where `PAD = 10` lives inside the column width, the ingredient
column comes out 20px narrower than the overlay's. Say whether the floors are
content widths or column widths, and adjust to 240/82 if the intent is to match.
file: `design.md:141`

**suggestion (non-blocking):** There is no problem statement. "Current state"
describes the code and "Desired end state" describes the solution, but the doc
never says who needs SVG, PNG, or PDF from a terminal, or why now. The nearest
thing is a clause inside decision 6 ("the extension exports PNG, and parity is the
feature"). Two sentences up top would let a future reader judge whether the 350 KB
font, the native dependency, and the three new modules bought anything. Scope
discipline is otherwise good — every new module traces to the stated feature, and
"Out of scope" is unusually concrete.
file: `design.md:10`

**nitpick (non-blocking):** Three small accuracy items, grouped. (a) `^2.6.2` is
described as "pinned" — a caret range is not a pin, and it already resolves the open
question at `design.md:256` automatically once 2.7.x ships stable. (b) The font's
OFL 1.1 gets a licence sentence but resvg's MPL-2.0 does not; `research.md:140` has
the reasoning, so one clause would close it. (c) `lineHeight = fontSize * 1.35` is
at `image.ts:74`, outside the cited `:88-99` range.
file: `design.md:260`

---

### Things I checked that hold up

- **The font path works from every documented install path.**
  `new URL('../assets/fonts/…', import.meta.url)` is independent of the working
  directory, and Node resolves symlinks to their real path for ESM by default, so
  `npm link` (`README.md:53-57`) lands in the repo checkout, not in the global
  prefix. `build.mjs:24` wipes `dist/` on every build but the font lives in
  `assets/`, so it survives. The only broken case is the one decision 5 already
  names: someone copying `dist/cli.mjs` out of the tree.
- **The OFL 1.1 claim is right.** Liberation Fonts 2.x are SIL OFL 1.1, and
  unmodified redistribution beside MIT code with the licence file kept is exactly
  what the OFL permits.
- **Regular weight only is correct for the stated target.** `image.ts:136` emits no
  `font-weight`, and `image.ts:72` builds its canvas font from the *table's*
  computed weight, not each cell's — so the extension's own export already draws
  `.rd-banner` and `.rd-op` at regular despite `overlay.css:147` and `:157`.
  Shipping one weight matches the export the design chose as its fidelity target.
- **Exit 2 for a TTY is consistent.** The contract at `run.ts:6-8` and `args.ts:35`
  calls 2 a usage error, and the `--claude` precedent at `run.ts:76-81` is a genuine
  match: the remedy is in the invocation, no network work has started. Rejecting
  `--out` is defensible on the same grounds — `run.ts:7` promises stdout carries only
  rendered output, and a path flag would add validation and partial-write handling
  for no new capability.
- **Every citation to `run.ts`, `args.ts`, `index.ts`, `image.ts`, `render-text.ts`,
  `types.ts`, `layout.ts`, and `build.mjs` resolves and says what the doc claims.**
  The `overlay.css:26` one is the exception, above.
- **The edge-case section covers all six required categories** — boundary, invalid,
  failure, concurrency, authorization, resource limits — which is more than most
  designs manage.

**REQUEST CHANGES**
