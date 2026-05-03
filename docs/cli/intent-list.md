---
title: intent list
id: intent-list
---

`intent list` discovers skill-enabled packages and prints available skills.

```bash
npx @tanstack/intent@latest list [--json] [--debug] [--exclude <pattern>] [--global] [--global-only]
```

## Options

- `--json`: print JSON instead of text output
- `--debug`: print discovery debug details to stderr
- `--exclude <pattern>`: exclude package names matching a simple glob; can be passed more than once
- `--global`: include global packages after project packages
- `--global-only`: list global packages only

## What you get

- Scans project and workspace dependencies for intent-enabled packages and skills
- Includes global packages only when `--global` or `--global-only` is passed
- Includes warnings from discovery
- Excludes packages matched by package.json `intent.exclude` or `--exclude`
- Prints debug details to stderr when `--debug` is passed
- If no packages are discovered, prints `No intent-enabled packages found.`
- Summary line with package count and skill count
- Package table columns: `PACKAGE`, `SOURCE`, `VERSION`, `SKILLS`
- Skill tree grouped by package
- Optional warnings section (`⚠ ...` per warning)

`SOURCE` is a lightweight indicator showing whether the selected package came from local discovery or explicit global scanning.
When both local and global packages are scanned, local packages take precedence.

## JSON output

`--json` prints an adapter-friendly skill list:

```json
{
  "skills": [
    {
      "use": "@tanstack/query#fetching",
      "packageName": "@tanstack/query",
      "packageRoot": "/path/to/project/node_modules/@tanstack/query",
      "packageVersion": "5.0.0",
      "packageSource": "local",
      "skillName": "fetching",
      "description": "Query data fetching patterns",
      "type": "skill (optional)",
      "framework": "react (optional)"
    }
  ],
  "packages": [
    {
      "name": "@tanstack/query",
      "version": "5.0.0",
      "source": "local",
      "packageRoot": "/path/to/project/node_modules/@tanstack/query",
      "skillCount": 1
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
  ]
}
```

When the same package exists both locally and globally and global scanning is enabled, `intent list` prefers the local package.
When project `node_modules` exists, `intent list` scans it. In Yarn PnP projects without usable `node_modules`, `intent list` uses Yarn's PnP API.

## Excludes

Package excludes are hard filters for packages that should not be used in a repo.
Intent reads `intent.exclude` arrays from package.json files while walking from the workspace or project root to the current working directory, then appends any `--exclude` flags.

```json
{
  "intent": {
    "exclude": ["@tanstack/*devtools*"]
  }
}
```

Exclude patterns match full package names. In v1, only exact names and `*` wildcards are supported.

## Common errors

- Scanner failures are printed as errors
- Unsupported environments:
  - Deno projects without `node_modules`
