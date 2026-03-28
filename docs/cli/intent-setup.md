---
title: setup commands
id: intent-setup
---

Intent exposes setup as two separate commands.

```bash
npx @tanstack/intent@latest edit-package-json
npx @tanstack/intent@latest setup-github-actions
```

## Commands

- `edit-package-json`: add or normalize `package.json` entries needed to publish skills
- `setup-github-actions`: copy workflow templates to `.github/workflows`

## What each command changes

- `edit-package-json`
  - Requires a valid `package.json` in current directory
  - Ensures `keywords` includes `tanstack-intent`
  - Ensures `files` includes required publish entries
  - Preserves existing indentation
- `setup-github-actions`
  - Copies templates from `@tanstack/intent/meta/templates/workflows` to `.github/workflows`
  - Applies variable substitution (`PACKAGE_NAME`, `PACKAGE_LABEL`, `PAYLOAD_PACKAGE`, `REPO`, `DOCS_PATH`, `SRC_PATH`, `WATCH_PATHS`)
  - Detects the workspace root in monorepos and writes repo-level workflows there
  - Generates monorepo-aware watch paths for package `src/` and docs directories
  - Skips files that already exist at destination

## Required `files` entries

`edit-package-json` enforces different `files` sets based on package location:

- Monorepo package: `skills`
- Non-monorepo package: `skills`, `!skills/_artifacts`

## Common errors

- Missing or invalid `package.json` when running `edit-package-json`
- Missing template source when running `setup-github-actions`

## Notes

- `setup-github-actions` skips existing files
- In monorepos, run `setup-github-actions` from either the repo root or a package directory; Intent writes workflows to the workspace root

## Related

- [intent validate](./intent-validate)
- [intent scaffold](./intent-scaffold)
