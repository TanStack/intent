---
title: setup commands
id: intent-setup
---

These commands configure a package for publishing skills and install the optional CI workflow. Repositories that use the [maintainer workflow](./intent-maintainer) keep `package.json` current with `intent maintainer sync` and only need `setup` from this page; `edit-package-json` is for repositories that publish skills without the maintainer workflow.

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: @tanstack/intent@latest edit-package-json
react: @tanstack/intent@latest setup
solid: @tanstack/intent@latest edit-package-json
solid: @tanstack/intent@latest setup
vue: @tanstack/intent@latest edit-package-json
vue: @tanstack/intent@latest setup
svelte: @tanstack/intent@latest edit-package-json
svelte: @tanstack/intent@latest setup
angular: @tanstack/intent@latest edit-package-json
angular: @tanstack/intent@latest setup
lit: @tanstack/intent@latest edit-package-json
lit: @tanstack/intent@latest setup

<!-- ::end:tabs -->

## Commands

- `edit-package-json`: add or normalize `package.json` entries needed to publish skills in a repository that does not use the maintainer workflow
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
- The copied workflow is a short caller with two jobs: pull requests call `TanStack/intent/.github/workflows/check-skills.yml` with `contents: read`, and release or manual runs call `review-skills.yml` with `contents: write` and `pull-requests: write`. Both are pinned to the commit of the Intent release that copied the file, written as `@<sha> # v<version>` so Dependabot and Renovate bump the pin; add a `github-actions` entry to `.github/dependabot.yml` if the repository has none
- Applies variable substitution (`PACKAGE_NAME`, `PACKAGE_LABEL`, `PAYLOAD_PACKAGE`, `REPO`, `DOCS_PATH`, `SRC_PATH`, `WATCH_PATHS`)
- Detects the workspace root in monorepos and writes repo-level workflows there
- Skips files that already exist at the destination

> [!NOTE]
> `setup` installs the generated repository workflow, not Intent's maintainer or consumer guidance. Run `maintainer setup` for persistent instructions and cumulative records.

## Required `files` entries

`edit-package-json` enforces different `files` sets based on package location:

- Monorepo package: `skills`
- Non-monorepo package: `skills`, `!skills/_artifacts`

`intent maintainer sync` instead adds one `skills/<name>` entry per registered skill to an existing `files` allowlist and leaves an absent allowlist absent. [`intent validate`](./intent-validate#packaging-warnings) accepts either layout. Do not run `edit-package-json` on a repository maintained by `sync`; the two write different entries.

## Common errors

- Missing or invalid `package.json` when running `edit-package-json`
- Missing template source when running `setup`

## Notes

- `setup` skips existing files
- On every pull request, `check-skills.yml` runs structural validation
- On pull requests with `.intent/review-state.json` or an `intent-maintainer` block, it also runs `intent maintainer check --base <pull-request-base-sha> --github-summary`, so the failure reasons appear in the job's step summary
- On release and manual runs with review state, it runs `intent review --github-review`; without review state, it falls back to `intent stale --github-review`
- Release and manual runs create or update one review-reminder pull request only when the selected check reports review work
- Both reusable workflows run the repository's own lockfile-pinned copy of `@tanstack/intent`, installed with the frozen lockfile and scripts disabled, so a new Intent version runs in CI only after its dependency bump merges. A repository without Intent in `devDependencies` fails with instructions; set the `intent-version` input (for example `latest`) on the caller's `with:` block to install from npm instead
- The workflows also accept `node-version` (default `22`), and the review workflow accepts `package-label`; edit the copied caller's `with:` block to change them
- A copy from an earlier Intent version that inlined the steps still works; `intent stale` prints a reminder when it is behind. Delete or move it and rerun `setup` to switch to the caller
- If your repo has an older generated `validate-skills.yml`, remove it after adopting the current `check-skills.yml`; PR validation now lives in `check-skills.yml`
- In monorepos, run `setup` from either the repo root or a package directory; Intent writes workflows to the workspace root

## Related

- [intent validate](./intent-validate)
- [intent review](./intent-review)
- [intent stale](./intent-stale)
- [intent maintainer](./intent-maintainer)
- [Maintainer quick start](../getting-started/quick-start-maintainers)
