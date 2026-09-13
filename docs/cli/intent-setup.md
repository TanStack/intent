---
title: setup commands
id: intent-setup
---

These commands configure a package for publishing skills and install the optional CI workflow. Repositories that use the [maintainer workflow](./intent-maintainer) keep `package.json` current with `intent maintainer sync` and install CI during `intent maintainer setup`; `edit-package-json` is for repositories that publish skills without the maintainer workflow.

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

@tanstack/intent@latest edit-package-json
@tanstack/intent@latest setup

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
- Pull requests call `check-skills.yml`; release and manual runs call `review-skills.yml`. Both have `contents: read`. A separate `publish-skill-review.yml` job has write access only when the repository opts into review PRs
- All three references use the full commit SHA packaged with the installed Intent release, written as `@<sha> # v<version>`. Setup never falls back to a mutable tag or resolves a release over the network. Dependabot or Renovate can propose pin updates; review them alongside the Intent dependency update
- Applies variable substitution (`PACKAGE_NAME`, `PACKAGE_LABEL`, `PAYLOAD_PACKAGE`, `REPO`, `DOCS_PATH`, `SRC_PATH`, `WATCH_PATHS`)
- Detects the workspace root in monorepos and writes repo-level workflows there
- Skips files that already exist at the destination
- New callers enable [repair artifacts](./intent-repair#ci-patches) for PR checks. CI applies safe mechanical repairs to its checkout and uploads patches for review; it never commits them. Existing callers can opt in with `repair: true`

> [!NOTE]
> `setup` installs the generated repository workflow, not Intent's maintainer or consumer guidance. Run `maintainer setup` to install the same CI workflow together with persistent instructions and cumulative records.

## Security and upgrades

Keep the generated full SHAs and review updates; a pin fixes a revision but does not certify its safety. Analysis has access to checked-out source even with a read-only token. Keep it on pull request, release, or manual events with no extra secrets, and keep write permissions confined to the optional publisher. Treat report and skill content as untrusted evidence, not authorization to execute commands or publish. See [GitHub's secure-use guidance](https://docs.github.com/en/actions/reference/security/secure-use).

For source development, setup requires a committed workflow reference. `INTENT_WORKFLOW_REF` can supply a separately verified full SHA when no packaged release reference exists. Published builds include their own reference.

To migrate an existing caller, inspect and move aside `.github/workflows/check-skills.yml`, rerun the installed `intent setup`, and compare the regenerated file before replacing it. Preserve intentional custom settings while adopting the read-only analysis jobs and explicit publisher opt-in. Updating only the pin leaves an older caller's permissions unchanged. Match `node-version` to the repository's supported Node version on both analysis jobs, and run the new installed CLI locally before making its check required. Older frontmatter, incomplete examples, and pending source reviews can require migration even when dependency installation succeeds.

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
- On pull requests without maintainer setup, `check-skills.yml` runs `intent validate --github-summary`
- With `.intent/review-state.json` or an `intent-maintainer` block, it runs the combined validation and review command `intent maintainer check --base <pull-request-base-sha> --github-summary`, so the failure reasons appear in the job's step summary
- On release and manual runs with review state, it runs `intent review --github-review`; without review state, it falls back to `intent stale --github-review`
- Release and manual runs write a step summary and, when work is pending, upload `review-items.json` as the `intent-review-report` artifact. To enable review-reminder PRs, set the repository Actions variable `INTENT_REVIEW_PULL_REQUESTS` to `true` and allow GitHub Actions to create pull requests in repository settings. The publisher uses a fresh runner with no checkout, dependency install, or Intent execution. It accepts a bounded JSON report from the same run, then creates an empty reminder commit or updates the existing bot PR body
- npm, pnpm, Yarn (including Plug'n'Play), and Bun lockfiles are supported. Yarn PnP runs the installed binary through Yarn so its loader is active
- Both reusable workflows run the repository's own lockfile-pinned copy of `@tanstack/intent`, installed with the frozen lockfile and scripts disabled, so a new Intent version runs in CI only after its dependency bump merges. Install Intent at the workspace root, preferably in `devDependencies`; an installation available only inside a child package cannot supply the root CI command. A missing root binary fails with instructions. Set the `intent-version` input to an exact reviewed npm version (never `latest` or a range) on the caller's `with:` block to install from npm instead
- The workflows also accept `node-version` (default `22`), and the review workflow accepts `package-label`; edit the copied caller's `with:` block to change them
- The validation workflow accepts `artifacts`, the repository-relative planning directory. `maintainer setup` copies its selected directory into the caller, including an explicit `--artifacts` choice. When migrating a repository with several planning directories, set this input to the established record so CI makes the same choice as the local maintainer command
- A copy from an earlier Intent version that inlined the steps still works; `intent stale` prints a reminder when it is behind. Delete or move it and rerun `setup` to switch to the caller
- If your repo has an older generated `validate-skills.yml`, remove it after adopting the current `check-skills.yml`; PR validation now lives in `check-skills.yml`
- In monorepos, run `setup` from either the repo root or a package directory; Intent writes workflows to the workspace root

## Related

- [intent validate](./intent-validate)
- [intent review](./intent-review)
- [intent stale](./intent-stale)
- [intent maintainer](./intent-maintainer)
- [Maintainer quick start](../getting-started/quick-start-maintainers)
