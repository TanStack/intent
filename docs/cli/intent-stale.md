---
title: intent stale
id: intent-stale
---

`intent stale` reports whether shipped skills may need review.

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: `@tanstack/intent@latest stale [dir] [--json] [--github-review] [--package-label <label>]`
solid: `@tanstack/intent@latest stale [dir] [--json] [--github-review] [--package-label <label>]`
vue: `@tanstack/intent@latest stale [dir] [--json] [--github-review] [--package-label <label>]`
svelte: `@tanstack/intent@latest stale [dir] [--json] [--github-review] [--package-label <label>]`
angular: `@tanstack/intent@latest stale [dir] [--json] [--github-review] [--package-label <label>]`
lit: `@tanstack/intent@latest stale [dir] [--json] [--github-review] [--package-label <label>]`

<!-- ::end:tabs -->

## Options

- `--json`: print JSON array of staleness reports
- `--github-review`: write review-reminder files and GitHub Actions output for the generated setup workflow
- `--package-label <label>`: set the fallback library label in generated reminder items

## Behavior

### Scope

- Checks the current package by default
- From a monorepo root, checks workspace packages that ship skills and also reports public workspace packages with no skill or artifact coverage
- Applies the `package.json#intent.skills` allowlist when falling back to installed dependencies; workspace packages are first-party and checked regardless. See [Configuration](../concepts/configuration).
- When `dir` is provided, scopes the check to the targeted package or skills directory
- Computes one staleness report per package

### Coverage

- Reads repo-root `_artifacts/*domain_map.yaml` and `_artifacts/*skill_tree.yaml` when present
- Flags public workspace packages that are not represented by generated skills or artifact coverage
- Skips workspace packages with `"private": true`

### Output and workflow state

- Prints text output by default or JSON with `--json`
- When skills or coverage need review, text output includes a command for your agent to load the focused authoring procedure; JSON contains only report data
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

| Field | Meaning |
| --- | --- |
| `library` | Package name |
| `currentVersion` | Local package version when available; otherwise latest from npm, or `null` if unavailable |
| `skillVersion` | `library_version` from skills, or `null` |
| `versionDrift` | `major`, `minor`, `patch`, or `null` |
| `skills` | Per-skill checks |
| `signals` | Artifact and workspace coverage checks |

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

## Review the findings

Ask your coding agent to run the command printed after a flagged report and follow it using that report and the relevant code/docs change. The command loads `generate-skill`, including its conditional review-signals reference. The agent reuses the existing conversation and repository evidence, then returns a disposition per item and a validated diff when edits are warranted.

The existing `--github-review` workflow mode writes `review-items.json` and, when there are items, `pr-body.md`. Its Agent Review instructions route to the same procedure. The command itself does not create a remote PR or edit skills; the installed GitHub workflow handles the review reminder.

Version drift and missing stored source SHAs do not prove that guidance is wrong. Review actual source changes before editing. Missing evidence stays unresolved, and an evidence-backed no-op may leave a signal flagged. Failed checks require logs; workflow advisories are separate maintenance items. Neither is a reason to rewrite skills.

### `stale` and `review` serve different checks

| Command | Evidence | Persistent result |
| --- | --- | --- |
| `intent stale` | Installed or registry package versions, stored source sync SHAs, artifacts, workflow version, and workspace package coverage. | Reports conservative signals; it does not record semantic review. |
| `intent review` | Git changes plus recorded source, skill, and planning-record fingerprints. | Records evidence-backed outcomes in `.intent/review-state.json` and reopens them when tracked content changes. |

## Common errors

- Package scan failure: prints a scanner error
- Registry fetch failures do not crash command; `currentVersion` may be `null`

## Notes

- Source staleness checking is conservative: it flags missing source SHAs in sync-state, not remote content differences.

## Related

- [Maintainer quick start](../getting-started/quick-start-maintainers)
- [intent review](./intent-review)
- [intent list](./intent-list)
