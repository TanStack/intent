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

- Checks the current package by default
- From a monorepo root, checks workspace packages that ship skills and also reports public workspace packages with no skill or artifact coverage
- When `dir` is provided, scopes the check to the targeted package or skills directory
- Computes one staleness report per package
- Reads repo-root `_artifacts/*domain_map.yaml` and `_artifacts/*skill_tree.yaml` when present
- Flags public workspace packages that are not represented by generated skills or artifact coverage
- Skips workspace packages with `"private": true`
- Prints text output by default or JSON with `--json`
- Prints a non-failing workflow update reminder when `.github/workflows/check-skills.yml` is missing the current `intent-workflow-version` stamp
- If no packages are found, prints `No intent-enabled packages found.`

Artifact coverage ignores can be recorded in `_artifacts/*skill_tree.yaml` or `_artifacts/*domain_map.yaml`:

```yaml
coverage:
  ignored_packages:
    - '@tanstack/internal-tooling'
    - name: packages/devtools-fixture
      reason: test fixture only
```

Ignored packages are excluded from missing coverage signals. Private workspace packages are excluded automatically.

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
    ],
    "signals": [
      {
        "type": "missing-package-coverage",
        "library": "string",
        "subject": "string",
        "reasons": ["string"],
        "needsReview": true,
        "packageName": "string",
        "packageRoot": "string"
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
- `signals`: array of artifact and workspace coverage checks

Skill fields:

- `name`
- `reasons`: one or more staleness reasons
- `needsReview`: boolean (`true` when reasons exist)

Reason generation:

- `version drift (<skillVersion> → <currentVersion>)`
- `new source (<path>)` when a declared source has no stored sync SHA
- artifact parse warnings, unresolved artifact skill paths, source drift, artifact library version drift, and missing workspace package coverage

## Text output

- Report header format: `<library> (<skillVersion> → <currentVersion>) [<versionDrift> drift]`
- When no skill reasons exist: `All skills up-to-date`
- Otherwise: one warning line per stale skill or review signal (`⚠ <name>: <reason1>, <reason2>, ...`)

## Common errors

- Package scan failure: prints a scanner error
- Registry fetch failures do not crash command; `currentVersion` may be `null`

## Notes

- Source staleness checking is conservative: it flags missing source SHAs in sync-state, not remote content differences.

## Related

- [intent list](./intent-list)
