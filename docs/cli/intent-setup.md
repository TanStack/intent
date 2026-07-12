---
title: intent setup
id: intent-setup
---

`intent setup` previews, checks, or applies the package and managed workflow configuration required to publish Intent skills.

> [!NOTE]
> Migration: bare `intent setup` is now non-mutating. Choose `--dry-run`, `--write`, or `--check`. The previous package-only and workflow-copy commands remain available for one compatibility window and print deprecation warnings.

Run the project-local Intent CLI. Its lockfile-recorded version keeps local and CI setup on the same reviewed release. The examples below use its binary name directly.

```bash
intent setup --dry-run
intent setup --write
intent setup --check
```

## Options

- `--dry-run`: print proposed `package.json` and managed workflow changes without writing.
- `--write`: apply exactly the planned changes.
- `--check`: fail when package or managed workflow changes are pending.

Use exactly one mode. Running `intent setup` without a mode writes nothing and prints the preview/write commands.

## Package configuration

Setup ensures each package that owns skills has:

- `tanstack-intent` in `keywords`;
- `skills` in `files`;
- `!skills/_artifacts` in `files` for single-package repositories.

Monorepo packages omit the artifact exclusion because their reviewed `_artifacts` directory lives at the workspace root. Existing package fields and indentation are preserved.

## Managed workflow

Setup manages `.github/workflows/check-skills.yml` at the workspace root.

The workflow is classified as:

- missing: safe to create;
- current: no change required;
- stale and fingerprinted: safe to update;
- custom or modified: reported as a conflict and never overwritten.

New managed workflows use an exact Intent version, disable npm install lifecycle scripts for the compatibility bridge, validate release-package contents with read-only repository access, and grant write permissions only to the review job.

## First run

```bash
intent setup --dry-run
intent setup --write
intent scaffold
```

Fresh monorepos may not have skill-owning packages yet. In that case setup creates the managed workflow and defers package fields. Run `setup --dry-run` and `setup --write` again after scaffolding creates package skill directories. Review all written files before committing them.

## Verify

```bash
intent setup --check
intent skills validate --release
```

## Compatibility commands

- `intent edit-package-json` retains the previous package-only write behavior.
- `intent setup-github-actions` retains the previous create-if-missing workflow behavior.

| Previous invocation | Replacement |
| --- | --- |
| `intent setup` | Choose `intent setup --dry-run`, `--write`, or `--check` |
| `intent edit-package-json` | `intent setup --dry-run`, then `intent setup --write` |
| `intent setup-github-actions` | `intent setup --dry-run`, then `intent setup --write` |

Both compatibility commands are deprecated and remain for one release window. Prefer explicit `intent setup` modes because they preview changes and protect modified workflows. Their exact removal version is not yet assigned.

## Troubleshooting

- If a workflow conflict is reported, move or reconcile the existing file before running `--write` again.
- If the bundled workflow template is unavailable, reinstall the project-local `@tanstack/intent` package.
- If no package is found, run setup from the package or workspace containing the skills.

## Related

- [intent scaffold](./intent-scaffold)
- [intent validate](./intent-validate)
