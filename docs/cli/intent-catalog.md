---
title: intent catalog
id: intent-catalog
---

`intent catalog` prints bounded, lock-verified skill context for coding agents. Humans can inspect trusted packages with [`intent list`](./intent-list).

<!-- ::start:tabs variant="package-manager" mode="local-install" -->
@tanstack/intent@latest catalog [package] [--json] [--refresh]
<!-- ::end:tabs -->

## Options

- `package`: include only one exact package name.
- `--json`: print structured skills, counts, warnings, cache status, and rendered context.
- `--refresh`: ignore a valid cache entry and rebuild the catalog.

## Output

The global catalog distributes its skill budget across packages so a package with many skills cannot hide every later package. Output is capped at 50 skills, 180 characters per description, and 8 KB. When the global catalog omits skills, run `intent catalog <package>` for the relevant package. Package catalogs use the same limits; a known omitted skill can still be loaded directly with `intent load <id>`.

Only skills accepted by `intent.lock` appear. New, changed, or unverifiable skills are withheld and reported by count. If trust or lock state is missing, catalog tells the agent to pause and ask the user to run `intent install` interactively.

The text footer tells the agent to load a matching skill with `intent load <id>` and continue normally when none match.

## JSON output

`--json` prints the same skills included in the byte-bounded `context`:

```json
{
  "cacheStatus": "hit",
  "context": "Available Intent skills: ...",
  "omittedSkillCount": 2,
  "skills": [
    {
      "id": "@tanstack/query#fetching",
      "description": "Query data fetching patterns"
    }
  ],
  "totalSkillCount": 3,
  "warnings": []
}
```

`cacheStatus` is `miss` for a new entry, `hit` for verified cached content, and `refresh` when an existing entry is rebuilt. Global and package catalogs have separate cache entries. The cache fingerprint includes dependency manifests, lockfiles, workspace configuration, trust policy, and accepted skill content.

## Related

- [`intent install`](./intent-install)
- [`intent list`](./intent-list)
- [`intent load`](./intent-load)
- [Trust model](../concepts/trust-model)
