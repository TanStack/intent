---
title: setup commands
id: intent-setup
---

Intent exposes publishing setup as two commands.

```bash
npx @tanstack/intent@latest edit-package-json
npx @tanstack/intent@latest setup
```

## Commands

- `edit-package-json`: add or normalize `package.json` entries needed to publish skills
- `setup`: copy workflow templates to `.github/workflows`
- `setup-github-actions`: legacy alias for `setup`

## What each command changes

### `edit-package-json`

- Requires a valid `package.json` in the current directory
- Ensures `keywords` includes `tanstack-intent`
- Ensures `files` includes required publish entries
- Preserves existing indentation

### `setup`

- Copies the `check-skills.yml` workflow template from `@tanstack/intent/meta/templates/workflows` to `.github/workflows`
- The copied workflow is a short caller for `TanStack/intent/.github/workflows/check-skills.yml`, pinned to Intent's major tag, so the checks update with Intent releases without an edit to the copy
- Applies variable substitution (`PACKAGE_NAME`, `PACKAGE_LABEL`, `PAYLOAD_PACKAGE`, `REPO`, `DOCS_PATH`, `SRC_PATH`, `WATCH_PATHS`)
- Detects the workspace root in monorepos and writes repo-level workflows there
- Skips files that already exist at the destination

## Required `files` entries

`edit-package-json` enforces different `files` sets based on package location:

- Monorepo package: `skills`
- Non-monorepo package: `skills`, `!skills/_artifacts`

## Common errors

- Missing or invalid `package.json` when running `edit-package-json`
- Missing template source when running `setup`

## Notes

- `setup` skips existing files
- `check-skills.yml` validates skills and runs `maintainer check --github-summary` on PRs, and opens review PRs from release/manual runs
- The reusable workflow accepts `package-label`, `intent-version` (default `latest`), and `node-version` (default `22`) inputs; edit the copied caller's `with:` block to change them
- A copy from an earlier Intent version that inlined the steps still works; `intent stale` prints a reminder when it is behind. Delete or move it and rerun `setup` to switch to the caller
- If your repo has an older generated `validate-skills.yml`, remove it after adopting the current `check-skills.yml`; PR validation now lives in `check-skills.yml`
- In monorepos, run `setup` from either the repo root or a package directory; Intent writes workflows to the workspace root

## Related

- [intent validate](./intent-validate)
- [intent scaffold](./intent-scaffold)
