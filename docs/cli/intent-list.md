---
title: intent list
id: intent-list
---

`intent list` discovers skill-enabled packages and prints available skills.

```bash
npx @tanstack/intent@latest list [--json] [--debug] [--global] [--global-only] [--no-notices]
```

## Options

- `--json`: print JSON instead of text output
- `--debug`: print discovery debug details to stderr
- `--global`: include global packages after project packages
- `--global-only`: list global packages only
- `--no-notices`: suppress non-critical notices on stderr

## What you get

- Scans project and workspace dependencies for intent-enabled packages and skills
- Surfaces packages permitted by `package.json#intent.skills` (see [Allowlist](#allowlist))
- Includes global packages only when `--global` or `--global-only` is passed
- Includes warnings from discovery
- Excludes packages and skills matched by package.json `intent.exclude`
- Prints debug details to stderr when `--debug` is passed
- If no packages are discovered, prints `No intent-enabled packages found.`
- Summary line with package count and skill count
- Package table columns: `PACKAGE`, `SOURCE`, `VERSION`, `SKILLS`
- Skill tree grouped by package
- Optional warnings section (`⚠ ...` per warning)
- Optional notices section on stderr (`ℹ ...` per notice), suppressed by `--no-notices`

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

## Allowlist

`package.json#intent.skills` is the allowlist that decides which discovered packages are surfaced. Only listed packages contribute skills.

```json
{
  "intent": {
    "skills": ["@tanstack/query", "workspace:@scope/internal"]
  }
}
```

Each entry is one source:

- `@scope/pkg` or `pkg`: an npm package reachable through the dependency tree.
- `workspace:@scope/pkg`: a package in the current workspace.
- `git:<host>/<repo>#<ref>`: reserved, and not yet supported.

The list as a whole has three special forms:

- **Absent** (no `intent.skills` key): every discovered package is surfaced, with a deprecation notice printed to stderr on each run until you set `intent.skills`. This is the upgrade path for existing projects. A future version will require an explicit allowlist.
- **Empty** (`"skills": []`): no package is surfaced, with an info notice printed to stderr.
- **Wildcard** (`"skills": ["*"]`): every discovered package is surfaced, with an acknowledged-risk notice printed to stderr.

A package that ships skills but is not listed is dropped. When packages are dropped this way, Intent prints one summary line naming them so you can opt in. A listed package that was not discovered is reported as well. Matching is currently by package name. See [Configuration](../concepts/configuration) and [Trust model](../concepts/trust-model).

## Excludes

Package excludes are hard filters for packages that should not be used in a repo, applied after the allowlist.
Intent reads `intent.exclude` arrays from package.json files while walking from the workspace or project root to the current working directory.
Manage persistent excludes with `intent exclude add|remove|list`.

```json
{
  "intent": {
    "exclude": ["@tanstack/*devtools*", "@tanstack/router#experimental-*"]
  }
}
```

A pattern without `#` excludes a whole package. A pattern with `#` excludes a single skill (`@scope/pkg#search-params`), and the skill segment may itself be a glob (`@scope/pkg#experimental-*`). A pattern may cross package boundaries at skill granularity (`*#experimental-*`). The `#*` shortcut (`@scope/pkg#*`) excludes the whole package. Only exact names and `*` wildcards are supported on each segment. Bare package-name patterns keep working unchanged.

An excluded package never triggers the unlisted-source warning, because an exclude is an explicit decision rather than an oversight.

## Common errors

- Scanner failures are printed as errors
- Unsupported environments:
  - Deno projects without `node_modules`
