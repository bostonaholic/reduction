# Changelog

All notable changes to Reduction are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/bostonaholic/reduction/commits/main
