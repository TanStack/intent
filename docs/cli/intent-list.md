---
title: intent list
id: intent-list
---

`intent list` discovers skill-enabled packages and prints available skills.

```bash
npx @tanstack/intent@latest list [--json] [--debug] [--global] [--global-only] [--show-hidden] [--no-notices]
```

## Options

### Output

- `--json`: print JSON instead of text output
- `--debug`: print discovery debug details to stderr
- `--no-notices`: suppress non-critical notices on stderr; the acknowledged-risk notice for `intent.skills: ["*"]` remains visible

### Scan scope

- `--global`: include global packages after project packages
- `--global-only`: list global packages only
- `--show-hidden`: show unlisted hidden skill sources when run outside an agent session

## What you get

### Selection

- Scans project and workspace dependencies for intent-enabled packages and skills
- Surfaces packages permitted by `package.json#intent.skills` (see [Allowlist](#allowlist))
- Includes global packages only when `--global` or `--global-only` is passed
- Excludes packages and skills matched by package.json `intent.exclude`

When both local and global packages are scanned, local packages take precedence. `SOURCE` shows whether the selected package came from local discovery or explicit global scanning.

### Text output

- Summary line with package count and skill count
- Package table columns: `PACKAGE`, `SOURCE`, `VERSION`, `SKILLS`
- Skill tree grouped by package
- Discovery warnings (`⚠ ...`) on stdout
- `No intent-enabled packages found.` when no packages are discovered

Policy notices (`ℹ ...`) are written to stderr.

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
  "hiddenSourceCount": 1,
  "hiddenSources": [
    {
      "name": "hidden-package",
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
- `@scope/*` or `workspace:@scope/*`: every discovered package of that kind whose name matches the pattern.
- `git:<host>/<repo>#<ref>`: reserved, and not yet supported.

The list as a whole has three special forms:

- **Absent** (no `intent.skills` key): every discovered package is surfaced, with a deprecation notice printed to stderr on each run until you set `intent.skills`. This is the upgrade path for existing projects. A future version will require an explicit allowlist.
- **Empty** (`"skills": []`): no package is surfaced, with an info notice printed to stderr.
- **Wildcard** (`"skills": ["*"]`): every discovered package is surfaced, with an acknowledged-risk notice printed to stderr. This exact trust-all entry is distinct from a scoped package pattern such as `@tanstack/*`.

A package that ships skills but is not listed or matched by a pattern is dropped. When packages are dropped this way, Intent prints one policy notice naming them so you can opt in. In agent sessions, hidden sources are reported by count only; run `intent list --show-hidden` outside the agent session to review candidates. An exact entry or pattern that matches no discovered package is reported as well. Package patterns support `*` wildcards. Matching uses both package name and source kind. See [Configuration](../concepts/configuration) and [Trust model](../concepts/trust-model).

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

An excluded package never triggers the unlisted-source notice, because an exclude is an explicit decision rather than an oversight.

## Common errors

- Scanner failures are printed as errors
- Deno projects without `node_modules` are unsupported
