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
- Applies variable substitution (`PACKAGE_NAME`, `PACKAGE_LABEL`, `PAYLOAD_PACKAGE`, `REPO`, `DOCS_PATH`, `SRC_PATH`, `WATCH_PATHS`)
- Detects the workspace root in monorepos and writes repo-level workflows there
- Skips files that already exist at the destination

> [!NOTE]
> `setup` installs the generated repository workflow, not Intent's maintainer or consumer guidance. Run `install --maintainer` separately for persistent authoring and source-review instructions.

## Required `files` entries

`edit-package-json` enforces different `files` sets based on package location:

- Monorepo package: `skills`
- Non-monorepo package: `skills`, `!skills/_artifacts`

## Common errors

- Missing or invalid `package.json` when running `edit-package-json`
- Missing template source when running `setup`

## Notes

- `setup` skips existing files
- On every pull request, `check-skills.yml` runs structural validation
- On pull requests with `.intent/review-state.json` or an `intent-maintainer` block, it also runs `intent review --base <pull-request-base-sha> --check`
- On release and manual runs with review state, it runs `intent review --github-review`; without review state, it falls back to `intent stale --github-review`
- Release and manual runs create or update one review-reminder pull request only when the selected check reports review work
- To adopt updated workflow templates, delete or move the old generated workflow files first, then rerun `setup`
- If your repo has an older generated `validate-skills.yml`, remove it after adopting the current `check-skills.yml`; PR validation now lives in `check-skills.yml`
- In monorepos, run `setup` from either the repo root or a package directory; Intent writes workflows to the workspace root

## Related

- [intent validate](./intent-validate)
- [intent review](./intent-review)
- [intent stale](./intent-stale)
- [intent scaffold](./intent-scaffold)
- [Maintainer quick start](../getting-started/quick-start-maintainers)
