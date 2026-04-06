---
title: intent stale
id: intent-stale
---

`intent stale` reports whether shipped skills may need review.

```bash
npx @tanstack/intent@latest stale [--json]
```

## Options

- `--json`: print JSON array of staleness reports

## Behavior

- Checks the current package by default, or all skill-bearing packages in the current workspace when run from a monorepo root
- When `dir` is provided, scopes the check to the targeted package or skills directory
- Computes one staleness report per package
- Prints text output by default or JSON with `--json`
- If no packages are found, prints `No intent-enabled packages found.`

## JSON report schema

`--json` outputs an array of reports:

```json
[
  {
    "library": "string",
    "currentVersion": "string | null",
    "skillVersion": "string | null",
    "versionDrift": "major | minor | patch | null",
    "skills": [
      {
        "name": "string",
        "reasons": ["string"],
        "needsReview": true
      }
    ]
  }
]
```

Report fields:

- `library`: package name
- `currentVersion`: latest version from npm registry (or `null` if unavailable)
- `skillVersion`: `library_version` from skills (or `null`)
- `versionDrift`: `major | minor | patch | null`
- `skills`: array of per-skill checks

Skill fields:

- `name`
- `reasons`: one or more staleness reasons
- `needsReview`: boolean (`true` when reasons exist)

Reason generation:

- `version drift (<skillVersion> → <currentVersion>)`
- `new source (<path>)` when a declared source has no stored sync SHA

## Text output

- Report header format: `<library> (<skillVersion> → <currentVersion>) [<versionDrift> drift]`
- When no skill reasons exist: `All skills up-to-date`
- Otherwise: one warning line per stale skill (`⚠ <name>: <reason1>, <reason2>, ...`)

## Common errors

- Package scan failure: prints a scanner error
- Registry fetch failures do not crash command; `currentVersion` may be `null`

## Notes

- Source staleness checking is conservative: it flags missing source SHAs in sync-state, not remote content differences.

## Related

- [intent list](./intent-list)
