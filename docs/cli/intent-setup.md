---
title: setup commands
id: intent-setup
---

Intent exposes setup as three separate commands.

```bash
npx @tanstack/intent@latest add-library-bin
npx @tanstack/intent@latest edit-package-json
npx @tanstack/intent@latest setup-github-actions
```

## Commands

- `add-library-bin`: create a package-local `intent` shim in `bin/`
- `edit-package-json`: add or normalize `package.json` entries needed to publish skills
- `setup-github-actions`: copy workflow templates to `.github/workflows`

## What each command changes

- `add-library-bin`
  - Creates `bin/intent.js` when `package.json.type` is `module`, otherwise `bin/intent.mjs`
  - If either shim already exists, command skips creation
  - Shim imports `@tanstack/intent/intent-library`
- `edit-package-json`
  - Requires a valid `package.json` in current directory
  - Ensures `bin.intent` points to `./bin/intent.<ext>`
  - Ensures `files` includes required publish entries
  - Preserves existing indentation and existing `bin` entries
  - Converts string shorthand `bin` to object when needed
- `setup-github-actions`
  - Copies templates from `@tanstack/intent/meta/templates/workflows` to `.github/workflows`
  - Applies variable substitution for `PACKAGE_NAME`, `REPO`, `DOCS_PATH`, `SRC_PATH`
  - Skips files that already exist at destination

## Required `files` entries

`edit-package-json` enforces different `files` sets based on package location:

- Monorepo package: `skills`, `bin`
- Non-monorepo package: `skills`, `bin`, `!skills/_artifacts`

## Common errors

- Missing or invalid `package.json` when running `edit-package-json`
- Missing template source when running `setup-github-actions`

## Notes

- `add-library-bin` and `setup-github-actions` skip existing files

## Related

- [intent validate](./intent-validate)
- [intent scaffold](./intent-scaffold)
