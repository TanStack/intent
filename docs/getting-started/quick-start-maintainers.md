---
title: Quick Start for Maintainers
id: quick-start-maintainers
---

After setup, request library changes as usual; Intent’s maintainer commands keep skill metadata consistent and record source-review evidence before handoff.

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

Run `maintainer setup` from the library repository:

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: @tanstack/intent@latest maintainer setup
solid: @tanstack/intent@latest maintainer setup
vue: @tanstack/intent@latest maintainer setup
svelte: @tanstack/intent@latest maintainer setup
angular: @tanstack/intent@latest maintainer setup
lit: @tanstack/intent@latest maintainer setup

<!-- ::end:tabs -->

This creates missing planning records and an `intent-maintainer` block in `AGENTS.md`, or updates the file that already contains an Intent maintainer or consumer block. It preserves surrounding instructions and a separate `intent-skills` consumer block. Review this setup diff and keep it in the repository so later agent sessions receive the same authoring and review procedure.

> [!NOTE]
> Setup preserves existing records and instructions. It creates skeletons for missing records; their task knowledge still needs authoring. The runner uses `@tanstack/intent@latest`. CI installation remains a separate command.

## Create the first useful batch

Ask your coding agent for the developer tasks the library should support. For example:

> Create a skill batch covering safe retries, cancellation, and pagination. Use our public examples and tests, and include executable checks for the important failure cases.

The installed instructions load Intent's `generate-skill` procedure. The agent reads the relevant source, tests, examples, docs, and existing skills; proposes a bounded batch when its scope is undecided; and creates or updates the guidance owned by those tasks. A focused batch does not require a full-library interview or a fixed number of skills.

Use `maintainer add` to create or register each agreed skill, keeping the file beside the owning package:

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: @tanstack/intent@latest maintainer add retries --package packages/client --domain requests --description "Use when configuring retries with this client." --source "src/retry.ts" --task "Retry a failed request with a bounded backoff"
solid: @tanstack/intent@latest maintainer add retries --package packages/client --domain requests --description "Use when configuring retries with this client." --source "src/retry.ts" --task "Retry a failed request with a bounded backoff"
vue: @tanstack/intent@latest maintainer add retries --package packages/client --domain requests --description "Use when configuring retries with this client." --source "src/retry.ts" --task "Retry a failed request with a bounded backoff"
svelte: @tanstack/intent@latest maintainer add retries --package packages/client --domain requests --description "Use when configuring retries with this client." --source "src/retry.ts" --task "Retry a failed request with a bounded backoff"
angular: @tanstack/intent@latest maintainer add retries --package packages/client --domain requests --description "Use when configuring retries with this client." --source "src/retry.ts" --task "Retry a failed request with a bounded backoff"
lit: @tanstack/intent@latest maintainer add retries --package packages/client --domain requests --description "Use when configuring retries with this client." --source "src/retry.ts" --task "Retry a failed request with a bounded backoff"

<!-- ::end:tabs -->

Run it from the repository root and pass `--package` for a workspace package, or run it inside that package's directory and the command registers the skill there. Omit `--package` for a standalone library. Repeat `--task` for each developer task the skill covers; it records them in `domain_map.yaml` so `maintainer check` does not ask for them later. For existing guidance, supply its name, domain, package, and path; the command preserves the file and reads its frontmatter. The [maintainer command reference](../cli/intent-maintainer) covers custom paths, prerequisites, and retiring a skill with `maintainer remove`.

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

For direct authoring guidance, load `meta generate-skill`. Explicitly requested full-library design still uses `meta domain-discovery`, then `meta tree-generator`, then `meta generate-skill`.

## Choose how consumers install the skills

Setup explains repository distribution until you record a choice, and `maintainer check` fails until one is recorded. Record the choice before the first check.

Selecting skills for repository distribution requires registered, authored skills: `maintainer sync` refuses to generate exports while a selected skill still carries the `intent:needs-authoring` marker. On a brand-new library, record `--distribution none` first, author the batch, then rerun setup with the selection. Select the public skills explicitly:

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: @tanstack/intent@latest maintainer setup --distribution repo --skill discover-library --skill retries
solid: @tanstack/intent@latest maintainer setup --distribution repo --skill discover-library --skill retries
vue: @tanstack/intent@latest maintainer setup --distribution repo --skill discover-library --skill retries
svelte: @tanstack/intent@latest maintainer setup --distribution repo --skill discover-library --skill retries
angular: @tanstack/intent@latest maintainer setup --distribution repo --skill discover-library --skill retries
lit: @tanstack/intent@latest maintainer setup --distribution repo --skill discover-library --skill retries

<!-- ::end:tabs -->

Use the actual registered names; each must be a tree entry whose `SKILL.md` exists. When the repository, plugin name, or selection cannot be resolved, setup reports every missing input in one error. This records the selection in the skill tree. `maintainer sync` generates plugin metadata pointing to the existing package directories and prints consumer commands for `npx skills add` and `gh skill add`. Consumers can also use the native Claude or Cursor plugin flow. No second copy of the skill text is created, and later skills are not added automatically.

To keep the package-only workflow, or to unblock `maintainer check` before the skills are authored, record the opt-out:

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: @tanstack/intent@latest maintainer setup --distribution none
solid: @tanstack/intent@latest maintainer setup --distribution none
vue: @tanstack/intent@latest maintainer setup --distribution none
svelte: @tanstack/intent@latest maintainer setup --distribution none
angular: @tanstack/intent@latest maintainer setup --distribution none
lit: @tanstack/intent@latest maintainer setup --distribution none

<!-- ::end:tabs -->

A repository discovery skill can help developers decide whether the library fits before installation. Respect their existing stack and hand implementation to the installed package's version of the guidance. Repository skills can be installed at project or user scope; those are consumer choices, separate from where the source files live. See [repository distribution](../cli/intent-maintainer#choose-repository-distribution).

## Keep guidance current during library work

Continue requesting library changes normally. `intent maintainer review` uses Git changes and content fingerprints to find work that has not been reviewed. Intent identifies candidates; the agent and maintainer decide whether the guidance should change. A new file does not automatically require a new skill. A justified `no-change` outcome records why accurate guidance stayed unchanged, while missing evidence remains pending.

Before handoff, run sync so the metadata matches the final files, review the pending items in your terminal, then run the combined check:

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: @tanstack/intent@latest maintainer sync
react: @tanstack/intent@latest maintainer review --interactive
react: @tanstack/intent@latest maintainer check
solid: @tanstack/intent@latest maintainer sync
solid: @tanstack/intent@latest maintainer review --interactive
solid: @tanstack/intent@latest maintainer check
vue: @tanstack/intent@latest maintainer sync
vue: @tanstack/intent@latest maintainer review --interactive
vue: @tanstack/intent@latest maintainer check
svelte: @tanstack/intent@latest maintainer sync
svelte: @tanstack/intent@latest maintainer review --interactive
svelte: @tanstack/intent@latest maintainer check
angular: @tanstack/intent@latest maintainer sync
angular: @tanstack/intent@latest maintainer review --interactive
angular: @tanstack/intent@latest maintainer check
lit: @tanstack/intent@latest maintainer sync
lit: @tanstack/intent@latest maintainer review --interactive
lit: @tanstack/intent@latest maintainer check

<!-- ::end:tabs -->

Interactive review shows each item's current guidance and changed files, asks for an outcome, and records the reason and evidence you supply. `maintainer check` then reports authoring gaps, generated files, and pending reviews together.

Coding agents follow the same steps without a terminal. The installed guidance instructs the agent to run `intent maintainer review --json`, examine affected skills, the planning record, and changed files outside existing source mappings, annotate each completed item with an outcome, reason, and evidence, then record the report with `intent maintainer review --record <report.json>`. The report's `recording` block lists the accepted outcomes and required fields; recording a report that annotates nothing fails.

Completed outcomes are saved in `.intent/review-state.json`. Keep that file with the source, skill, and planning-record changes it describes. Files Intent writes for you, such as the agent instruction block, plugin manifests, `package.json`, and lockfiles, do not appear as unmapped changes.

See [`intent review`](../cli/intent-review) for comparison rules, report fields, ignored paths, recording, and failure recovery.

## Configure publishing

Run the same synchronization command after skill edits. Add the optional CI workflow when the repository is ready for it:

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: @tanstack/intent@latest maintainer sync
react: @tanstack/intent@latest setup
solid: @tanstack/intent@latest maintainer sync
solid: @tanstack/intent@latest setup
vue: @tanstack/intent@latest maintainer sync
vue: @tanstack/intent@latest setup
svelte: @tanstack/intent@latest maintainer sync
svelte: @tanstack/intent@latest setup
angular: @tanstack/intent@latest maintainer sync
angular: @tanstack/intent@latest setup
lit: @tanstack/intent@latest maintainer sync
lit: @tanstack/intent@latest setup

<!-- ::end:tabs -->

`maintainer sync` aligns the tree, adds the `tanstack-intent` keyword, updates existing package `files` allowlists, and generates selected repository exports. It preserves authored decisions and an absent npm allowlist. Inspect the packed archive as part of the library’s release checks, including whether planning records should be excluded.

`setup` copies `check-skills.yml` to the workspace root's `.github/workflows/` directory and skips an existing destination file. The workflow validates skills and recorded source reviews on pull requests. After a release or manual run, it creates or updates a review-reminder pull request when recorded review state or conservative staleness signals require attention. See [setup commands](../cli/intent-setup).

> [!NOTE]
> `intent setup` copies CI templates; `intent maintainer setup` initializes the maintainer workflow. To replace an older generated workflow, move or delete it before rerunning `setup`; Intent skips existing files.

Publish through the library's normal release process. Skills in the package's published `skills/` directory version with that library release. Consumers install the library, configure permitted skill sources with consumer [`intent install`](../cli/intent-install#default-install), discover the installed skills with [`intent list`](../cli/intent-list), and load matching guidance with `intent load`.

## Check package and release signals

[`intent stale`](../cli/intent-stale) remains the conservative package-level check for version drift, missing source sync SHAs, artifact warnings, and workspace package coverage. It does not compare source diffs or prove that guidance changed. Use `intent maintainer review` for source-aware, recorded maintenance in repositories that enabled the maintainer workflow.
