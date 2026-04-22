---
title: intent load
id: intent-load
---

`intent load` loads a compact skill identity from the current install and prints the matching `SKILL.md` content.

```bash
npx @tanstack/intent@latest load <package>#<skill> [--path] [--json] [--global] [--global-only]
```

## Options

- `--path`: print the resolved skill path instead of the file content
- `--json`: print structured JSON with metadata and content
- `--global`: load from project packages first, then global packages
- `--global-only`: load from global packages only

## What you get

- Validates `<package>#<skill>` before scanning
- Scans project-local packages by default
- Includes global packages only when `--global` or `--global-only` is passed
- Prefers local packages when `--global` is used and the same package exists locally and globally
- Prints raw `SKILL.md` content by default
- Prints the scanner-reported path when `--path` is passed

The package can be scoped or unscoped. The skill can include slash-separated sub-skill names.

Examples:

```bash
npx @tanstack/intent@latest load @tanstack/query#fetching
npx @tanstack/intent@latest load @tanstack/query#core/fetching
npx @tanstack/intent@latest load some-lib#core --path
```

## JSON output

`--json` prints:

```json
{
  "package": "@tanstack/query",
  "skill": "fetching",
  "path": "node_modules/@tanstack/query/skills/fetching/SKILL.md",
  "packageRoot": "node_modules/@tanstack/query",
  "source": "local",
  "version": "5.0.0",
  "content": "---\nname: fetching\n---\n\n...",
  "warnings": []
}
```

## Common errors

- Missing separator: `Invalid skill use "@tanstack/query": expected <package>#<skill>.`
- Empty package: `Invalid skill use "#core": package is required.`
- Empty skill: `Invalid skill use "@tanstack/query#": skill is required.`
- Missing package: `Cannot resolve skill use "...": package "..." was not found.`
- Missing skill: `Cannot resolve skill use "...": skill "..." was not found in package "...".`

## Related

- [intent list](./intent-list)
- [intent install](./intent-install)
