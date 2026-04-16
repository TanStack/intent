---
title: intent resolve
id: intent-resolve
---

`intent resolve` resolves a compact skill identity to the skill file path reported by the current install.

```bash
npx @tanstack/intent@latest resolve <package>#<skill> [--json] [--global] [--global-only]
```

## Options

- `--json`: print structured JSON instead of only the path
- `--global`: resolve from project packages first, then global packages
- `--global-only`: resolve from global packages only

## What you get

- Validates `<package>#<skill>` before scanning
- Scans project-local packages by default
- Includes global packages only when `--global` or `--global-only` is passed
- Prefers local packages when `--global` is used and the same package exists locally and globally
- Prints the resolved skill path by default
- Returns scanner-reported paths, including package-manager-internal paths for transitive installs

The package can be scoped or unscoped. The skill can include slash-separated sub-skill names.

Examples:

```bash
npx @tanstack/intent@latest resolve @tanstack/query#fetching
npx @tanstack/intent@latest resolve @tanstack/query#core/fetching
npx @tanstack/intent@latest resolve some-lib#core
```

## JSON output

`--json` prints:

```json
{
  "package": "@tanstack/query",
  "skill": "fetching",
  "path": "node_modules/@tanstack/query/skills/fetching/SKILL.md",
  "source": "local",
  "version": "5.0.0",
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
