---
topic: cli-and-agent-skill
date: 2026-07-29
phase: task
ticketId: null
---

# Task: cli-and-agent-skill

## Description
Along with the Chrome extension, the user also wants this project's recipe-URL
parsing available as (a) a command-line interface, and (b) an agent Skill so
that Claude Code, or any other coding agent that supports Skills, can invoke
the same parsing of a recipe URL. This repo (`reduction`, formerly recipart)
already turns any recipe page into a Cooking For Engineers style tabular
diagram — ingredients as rows, operations spanning the rows they consume —
inside a Chrome extension. The user wants that same capability reachable
outside the browser.

## Stated goal
Let people run the same recipe-URL parsing from a CLI, and from Claude Code
(or another skill-capable coding agent) via an agent Skill.

## Inferred goal
Give a developer working in a terminal or inside a coding agent session a way
to turn a recipe URL into the same ingredient/operation table the extension
produces, without opening Chrome — reusing the existing extraction, inference,
layout, and render pipeline (`src/core/extract.ts`, `infer.ts`, `layout.ts`,
`render.ts`) rather than re-implementing it, and packaging a thin Skill
definition that tells an agent how to invoke that CLI.

## Acceptance signals
- A developer can run a command (e.g. `npx reduction <url>` or an installed
  `bin`) that fetches a recipe page, runs it through the existing pipeline,
  and prints the resulting table to the terminal or to a file.
- A `SKILL.md` (or equivalent agent-skill definition) exists that Claude Code
  or another skill-capable agent can discover, describing how to call the CLI
  to get the same output for a given recipe URL.
- Neither the CLI nor the Skill duplicates the extraction/inference/layout
  logic — both sit on top of the same `src/core/*` modules the extension
  already uses.
- Existing extension behavior (`npm run build`, the loaded-unpacked Chrome
  extension) is unaffected.

## Open assumptions
- Single repo: the description does not name a second repository, and no
  sibling directory was implied, so the CLI and the Skill both live in this
  repo (`reduction`) alongside the extension. No `repos.md` written.
- The CLI is assumed to be a new Node entry point added to this existing
  package (e.g. a `bin` script), not a separate published package — open for
  the design phase to confirm.
- Output format (plain text, Markdown table, or the same HTML the extension
  renders) is not specified by the user and is left to the design phase.
- Whether the CLI needs the optional Claude-based inference fallback (the
  extension's `src/llm/claude.ts` tier, gated on a stored API key) or should
  rely on local heuristics only is not specified and is left to the design
  phase.
- "Skill" is assumed to mean the Anthropic Agent Skills convention (a
  `SKILL.md` with frontmatter plus instructions, invoked by a skill-capable
  agent) since the user explicitly named Claude Code; exact packaging
  location/format is left to the design phase.
