# Changelog

All notable changes to Reduction are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Badge cards whose self-check finds a structural or faithfulness problem as
  "low" confidence, naming the finding — coverage alone no longer decides the
  badge. Those failures now also escalate to Claude even above 60% confidence,
  and the more truthful candidate can win the selection at lower coverage. (#12)
- Wide CLI diagrams shrink toward the overlay's 1180px width instead of
  stretching to their banner text, so a long-banner recipe reads like the
  overlay at its widest. Columns never shrink below their minimum widths, so
  a many-column recipe stays legible and simply goes over the target.

### Added

- Include the recipe's URL in the generated recipe card. (#9)
- `--format svg` in the CLI: the same diagram the extension exports, as a
  standalone SVG image, rendered without a browser. The confidence note goes
  to stderr so the artifact stays clean.
- `--format png` in the CLI: the extension's 2× PNG export, rasterized with
  the optional `@resvg/resvg-js` dependency and the bundled Liberation Sans
  face. Binary output must be redirected to a file — a terminal refuses it —
  and very large diagrams are scaled down (with a notice on stderr) to bound
  memory.
- `--format pdf` in the CLI: the diagram as a one-page PDF with selectable,
  searchable text, written without any PDF library. Diagrams past the
  14,400pt page limit are scaled to fit, with a notice on stderr.
- A `reduction` CLI: render any recipe URL as a tabular diagram from the
  terminal, in box-drawing text (default), JSON, or HTML. Install it with
  `npm link`; pass `--claude` to opt in to Claude escalation for
  low-confidence parses (requires `ANTHROPIC_API_KEY`).
- An agent Skill at `.claude/skills/reduction`, so Claude Code and other
  skill-capable agents can drive the CLI on a recipe link.
- A banner row announces when a recipe's ingredient or step list was capped at
  500 items, rather than presenting a truncated diagram as complete — in the
  extension and the CLI alike.

### Changed

- Wide CLI diagrams shrink toward the overlay's 1180px width instead of
  stretching to their banner text, so a long-banner recipe reads like the
  overlay at its widest. Columns never shrink below their minimum widths, so
  a many-column recipe stays legible and simply goes over the target.

### Security

- Text displayed from a recipe page is stripped of control and bidi override
  characters, so a hostile page cannot smuggle terminal escapes or
  direction-flipping text into what you see.
- Each line sent to Claude is bounded (ingredients and titles at 300
  characters, steps at 2,000), so a hostile page cannot fill the context
  window — and your API budget — with one enormous line.

### Internal

- jsdom is now a runtime dependency (the CLI parses fetched pages with it),
  and `npm install` builds the project via the `prepare` script.

## [0.1.0] - 2026-07-29

### Added

- Render any recipe page as a tabular diagram — ingredients as rows, operations
  spanning the rows they consume.
- Toggle the overlay from the toolbar button or with
  <kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd>.
- Read recipes from JSON-LD, microdata, or DOM heuristics.
- Normalize ingredient lines into quantities, units, and metric equivalents.
- Attach each operation to the ingredients it acts on, and label it by its
  work. (#1)
- Choose the Claude model and effort level used to infer the recipe tree. (#2)
- Export the diagram as an image, or print it.

### Fixed

- Write a plural unit when a recipe calls for more than one — "2 cloves garlic",
  not "2 clove garlic". (#5)

[Unreleased]: https://github.com/bostonaholic/reduction/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/bostonaholic/reduction/releases/tag/v0.1.0
