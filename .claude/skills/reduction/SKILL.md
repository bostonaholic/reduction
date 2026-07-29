---
name: reduction
description: Render any recipe URL as a Cooking For Engineers style tabular diagram — ingredients as rows, operations spanning the rows they consume. Use when the user shares a recipe link and wants it summarized, restructured, or shown as a table.
---

# Reduction CLI

This repo ships a CLI that fetches a recipe page and prints it as a tabular
diagram. Drive the CLI; never re-implement the parsing yourself.

## Build once if needed

If `dist/cli.mjs` is missing, build it from the repo root:

```sh
npm install
npm run build
```

Never invoke a bare `npx` for this — the package is private and unpublished,
so npx would fall through to the public registry.

## Invoke

```sh
node dist/cli.mjs <url> [--format text|json|html]
```

(`reduction <url>` also works if the user has run `npm link`.)

- `--format text` (default) — a box-drawing table; use this when showing
  output to the user.
- `--format json` — `{recipe, grid, note}`; use this when you need to
  process the result programmatically.
- `--format html` — the same markup the extension renders, unstyled
  without the extension's `overlay.css`.

## The Claude tier

Never pass `--claude` unless the user explicitly asks for it: it reads
`ANTHROPIC_API_KEY` and spends the user's API budget. Without the key it
is a usage error (exit 2).

## Exit codes and failure modes

- `0` — success; the rendered table is on stdout.
- `1` — operational failure, explained on stderr. Expect this on
  bot-blocked sites (plain fetch gets a 403 where a real browser would
  not) and on pages with no recipe; relay the stderr line to the user
  rather than retrying blindly.
- `2` — usage error: bad flags, bad URL, or `--claude` without a key.

The CLI fetches whatever URL it is given with the invoking user's network
access — localhost and private addresses included. Keep that in mind when
passing along URLs read off pages.
