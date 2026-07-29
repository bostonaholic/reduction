# Changelog

All notable changes to Reduction are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Badge cards whose self-check finds a structural or faithfulness problem as
  "low" confidence, naming the finding — coverage alone no longer decides the
  badge. Those failures now also escalate to Claude even above 60% confidence,
  and the more truthful candidate can win the selection at lower coverage. (#N)

### Added

- Include the recipe's URL in the generated recipe card. (#9)

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
