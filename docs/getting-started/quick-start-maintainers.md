---
title: Quick Start for Maintainers
id: quick-start-maintainers
---

Enable Intent in a library repository, create a focused skill batch with your existing coding agent, keep the guidance reviewed as the library changes, then configure publishing separately.

## Install

<!-- ::start:tabs variant="package-manager" mode="dev-install" -->

react: @tanstack/intent
solid: @tanstack/intent
vue: @tanstack/intent
svelte: @tanstack/intent
angular: @tanstack/intent
lit: @tanstack/intent

<!-- ::end:tabs -->

## Enable the maintainer workflow

Run `install --maintainer` from the library repository:

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: @tanstack/intent@latest install --maintainer
solid: @tanstack/intent@latest install --maintainer
vue: @tanstack/intent@latest install --maintainer
svelte: @tanstack/intent@latest install --maintainer
angular: @tanstack/intent@latest install --maintainer
lit: @tanstack/intent@latest install --maintainer

<!-- ::end:tabs -->

This creates an `intent-maintainer` block in `AGENTS.md`, or updates the file that already contains an Intent maintainer or consumer block. It preserves surrounding instructions and a separate `intent-skills` consumer block. Review this setup diff and keep it in the repository so later agent sessions receive the same authoring and review procedure.

> [!NOTE] This command installs repository guidance
> The runner executes `@tanstack/intent@latest`. `install --maintainer` does not add a dependency, change consumer permissions, install agent hooks, or add CI.

## Create the first useful batch

Ask your coding agent for the developer tasks the library should support. For example:

> Create a skill batch covering safe retries, cancellation, and pagination. Use our public examples and tests, and include executable checks for the important failure cases.

The installed instructions load Intent's `generate-skill` procedure. The agent reads the relevant source, tests, examples, docs, and existing skills; proposes a bounded batch when its scope is undecided; and creates or updates the guidance owned by those tasks. A focused batch does not require a full-library interview or a fixed number of skills.

Every skill batch also creates or incrementally updates three planning documents. These records preserve prior scope, maintainer decisions, exclusions, source mappings, and remaining work across later batches.

<!-- ::start:tabs variant="files" -->

```text title="Standalone package"
skills/
  task-name/
    SKILL.md
  _artifacts/
    domain_map.yaml
    skill_spec.md
    skill_tree.yaml
```

```text title="Monorepo"
_artifacts/
  domain_map.yaml
  skill_spec.md
  skill_tree.yaml
packages/
  client/
    skills/
      task-name/
        SKILL.md
```

<!-- ::end:tabs -->

Existing custom skill and artifact locations are retained when supported. The domain map records domains and developer tasks, the spec records readable coverage and decisions, and the tree records skill placement, prerequisites, and source mappings.

Review the resulting skills, planning documents, and checks as one batch:

| Check | Evidence |
| --- | --- |
| Structure | Frontmatter, required fields, and line limits; inspect reference paths and reading conditions separately. |
| Developer task | Executable checks accept a working solution and reject a plausible mistake. |
| Discovery | Realistic matching and adjacent nonmatching requests exercise the skill description. |
| Fresh consumer | An isolated agent attempts the task with the candidate skills and protected checks grade the result. |
| Bundled scripts, when present | Documented commands run from the installed package layout with valid and invalid inputs. |

A missing runtime or independent run remains explicitly unverified. Structural validation alone does not establish task correctness, skill discovery, or fresh-consumer behavior.

## Keep guidance current during library work

Continue requesting library changes normally. Before handoff, the installed guidance instructs the agent to run `intent review --json`, examine affected skills, the planning record, and changed files outside existing source mappings, then record each completed decision with its evidence.

`intent review` uses Git changes and content fingerprints to find work that has not been reviewed. Intent identifies candidates; the agent and maintainer decide whether the guidance should change. A new file does not automatically require a new skill. A justified `no-change` outcome records why accurate guidance stayed unchanged, while missing evidence remains pending.

Completed outcomes are saved in `.intent/review-state.json`. Keep that file with the source, skill, and planning-record changes it describes. Run `intent review --check` to verify that no review items remain before handoff.

See [`intent review`](../cli/intent-review) for comparison rules, report fields, recording, and failure recovery.

## Use standalone authoring when needed

Without maintainer installation, [`intent scaffold`](../cli/intent-scaffold) prints the same focused authoring entry point for your current agent conversation:

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: @tanstack/intent@latest scaffold
solid: @tanstack/intent@latest scaffold
vue: @tanstack/intent@latest scaffold
svelte: @tanstack/intent@latest scaffold
angular: @tanstack/intent@latest scaffold
lit: @tanstack/intent@latest scaffold

<!-- ::end:tabs -->

Use this for a one-off batch or update. Installing the maintainer block instructs agents to route later ordinary library work through review.

For an explicitly requested full-library design, the scaffold procedure retains the longer sequence: `domain-discovery`, then `tree-generator`, then `generate-skill`. That branch includes library-wide research, maintainer interviews, and review gates. Focused work reuses its planning decisions when they already exist.

## Configure publishing

Authoring does not change package publishing or CI. When the skill batch is ready to ship, configure those separately:

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

`edit-package-json` adds the `tanstack-intent` keyword and the `files` entries needed to publish `skills/`. For a standalone package it also excludes `skills/_artifacts`; a monorepo keeps the shared `_artifacts/` directory at the repository root, outside its package tarballs.

`setup` copies `check-skills.yml` to the workspace root's `.github/workflows/` directory and skips an existing destination file. The workflow validates skills and recorded source reviews on pull requests. After a release or manual run, it creates or updates a review-reminder pull request when recorded review state or conservative staleness signals require attention. See [setup commands](../cli/intent-setup).

> [!WARNING] Review generated repository changes
> `edit-package-json`, `setup`, and `install --maintainer` change different files for different purposes. Inspect each diff before keeping it. To replace an older generated workflow, move or delete it yourself before rerunning `setup`; Intent does not overwrite it.

Publish through the library's normal release process. Skills in the package's published `skills/` directory version with that library release. Consumers install the library, configure permitted skill sources with consumer [`intent install`](../cli/intent-install#default-install), discover the installed skills with [`intent list`](../cli/intent-list), and load matching guidance with `intent load`.

## Check package and release signals

[`intent stale`](../cli/intent-stale) remains the conservative package-level check for version drift, missing source sync SHAs, artifact warnings, and workspace package coverage. It does not compare source diffs or prove that guidance changed. Use `intent review` for source-aware, recorded maintenance in repositories that enabled the maintainer workflow.
