---
title: intent list
id: intent-list
---

`intent list` discovers skill-enabled packages and prints available skills.

```bash
npx @tanstack/intent@latest list [--json] [--global] [--global-only]
```

## Options

- `--json`: print JSON instead of text output
- `--global`: include global packages after project packages
- `--global-only`: list global packages only

## What you get

- Scans project and workspace dependencies for intent-enabled packages and skills
- Includes global packages only when `--global` or `--global-only` is passed
- Includes warnings from discovery
- If no packages are discovered, prints `No intent-enabled packages found.`
- Summary line with package count, skill count, and detected package manager
- Package table columns: `PACKAGE`, `SOURCE`, `VERSION`, `SKILLS`, `REQUIRES`
- Skill tree grouped by package
- Optional warnings section (`⚠ ...` per warning)

`REQUIRES` uses `intent.requires` values joined by `, `; empty values render as `–`.
`SOURCE` is a lightweight indicator showing whether the selected package came from local discovery or explicit global scanning.
When both local and global packages are scanned, local packages take precedence.

## JSON output

`--json` prints the `ScanResult` object:

```json
{
  "packageManager": "npm | pnpm | yarn | bun | unknown",
  "packages": [
    {
      "name": "string",
      "version": "string",
      "source": "local | global",
      "packageRoot": "string",
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
  "warnings": ["string"],
  "conflicts": [
    {
      "packageName": "string",
      "chosen": {
        "version": "string",
        "packageRoot": "string"
      },
      "variants": [
        {
          "version": "string",
          "packageRoot": "string"
        }
      ]
    }
  ],
  "nodeModules": {
    "local": {
      "path": "string",
      "detected": true,
      "exists": true,
      "scanned": true
    },
    "global": {
      "path": "string | null",
      "detected": true,
      "exists": true,
      "scanned": false,
      "source": "string (optional)"
    }
  }
}
```

`packages` are ordered using `intent.requires` when possible.
When the same package exists both locally and globally and global scanning is enabled, `intent list` prefers the local package.

## Common errors

- Scanner failures are printed as errors
- Unsupported environments:
  - Yarn PnP without `node_modules`
  - Deno projects without `node_modules`
