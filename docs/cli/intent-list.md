---
title: intent list
id: intent-list
---

`intent list` discovers skill-enabled packages and prints available skills.

```bash
npx @tanstack/intent@latest list [--json]
```

## Options

- `--json`: print JSON instead of text output

## What you get

- Scans installed dependencies for intent-enabled packages and skills
- Includes warnings from discovery
- If no packages are discovered, prints `No intent-enabled packages found.`
- Summary line with package count, skill count, and detected package manager
- Package table columns: `PACKAGE`, `VERSION`, `SKILLS`, `REQUIRES`
- Skill tree grouped by package
- Optional warnings section (`⚠ ...` per warning)

`REQUIRES` uses `intent.requires` values joined by `, `; empty values render as `–`.

## JSON output

`--json` prints the `ScanResult` object:

```json
{
  "packageManager": "npm | pnpm | yarn | bun | unknown",
  "packages": [
    {
      "name": "string",
      "version": "string",
      "intent": {
        "version": 1,
        "repo": "string",
        "docs": "string",
        "requires": ["string"]
      },
      "skills": [
        {
          "name": "string",
          "path": "string",
          "description": "string",
          "type": "string (optional)",
          "framework": "string (optional)"
        }
      ]
    }
  ],
  "warnings": ["string"]
}
```

`packages` are ordered using `intent.requires` when possible.

## Common errors

- Scanner failures are printed as errors
- Unsupported environments:
  - Yarn PnP without `node_modules`
  - Deno projects without `node_modules`
