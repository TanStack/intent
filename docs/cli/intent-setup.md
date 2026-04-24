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

- `edit-package-json`
  - Requires a valid `package.json` in current directory
  - Ensures `keywords` includes `tanstack-intent`
  - Ensures `files` includes required publish entries
  - Preserves existing indentation
- `setup`
  - Copies templates from `@tanstack/intent/meta/templates/workflows` to `.github/workflows`
  - Applies variable substitution (`PACKAGE_NAME`, `PACKAGE_LABEL`, `PAYLOAD_PACKAGE`, `REPO`, `DOCS_PATH`, `SRC_PATH`, `WATCH_PATHS`)
  - Detects the workspace root in monorepos and writes repo-level workflows there
  - Skips files that already exist at destination

## Required `files` entries

`edit-package-json` enforces different `files` sets based on package location:

- Monorepo package: `skills`
- Non-monorepo package: `skills`, `!skills/_artifacts`

## Common errors

- Missing or invalid `package.json` when running `edit-package-json`
- Missing template source when running `setup`

## Notes

- `setup` skips existing files
- To adopt updated workflow templates, delete or move the old generated workflow files first, then rerun `setup`
- In monorepos, run `setup` from either the repo root or a package directory; Intent writes workflows to the workspace root

## Related

- [intent validate](./intent-validate)
- [intent scaffold](./intent-scaffold)
