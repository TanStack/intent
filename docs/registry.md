---
title: Get Listed on the Registry
---

The [Agent Skills Registry](/intent/registry) automatically discovers and indexes npm packages that ship Agent Skills. There's no manual submission process — publish skills in your package and the registry picks them up.

## How discovery works

The registry periodically searches npm for packages with the `tanstack-intent` keyword. When it finds one, it downloads the tarball, extracts every `skills/**/SKILL.md` file, and indexes the contents. Each new version you publish gets indexed automatically.

## Ship skills in 4 steps

### 1. Create a skill batch

For repository-wide maintenance, enable the maintainer workflow once:

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: @tanstack/intent@latest maintainer setup
solid: @tanstack/intent@latest maintainer setup
vue: @tanstack/intent@latest maintainer setup
svelte: @tanstack/intent@latest maintainer setup
angular: @tanstack/intent@latest maintainer setup
lit: @tanstack/intent@latest maintainer setup

<!-- ::end:tabs -->

Register agreed skills with `maintainer add`, then ask your coding agent to author the developer tasks they cover. The installed instructions load the focused authoring procedure, maintain the shared planning record, and run source-aware review before handoff.

For a one-off authoring session, tell the agent to run:

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: @tanstack/intent@latest meta generate-skill
solid: @tanstack/intent@latest meta generate-skill
vue: @tanstack/intent@latest meta generate-skill
svelte: @tanstack/intent@latest meta generate-skill
angular: @tanstack/intent@latest meta generate-skill
lit: @tanstack/intent@latest meta generate-skill

<!-- ::end:tabs -->

Give the agent a developer task or concrete code/docs change. The focused procedure creates or updates the relevant guidance and validates it for review; full-library discovery remains available when explicitly requested. Skills use the owning package's `skills/` directory or its existing custom root. Record the [repository distribution choice](./cli/intent-maintainer#choose-repository-distribution) during setup: select public skills or use `maintainer setup --distribution none` for the package-only workflow. See the [maintainer quick start](./getting-started/quick-start-maintainers).

### 2. Synchronize metadata

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: @tanstack/intent@latest maintainer sync
solid: @tanstack/intent@latest maintainer sync
vue: @tanstack/intent@latest maintainer sync
svelte: @tanstack/intent@latest maintainer sync
angular: @tanstack/intent@latest maintainer sync
lit: @tanstack/intent@latest maintainer sync

<!-- ::end:tabs -->

This adds the `tanstack-intent` keyword and registered skill directories to existing `files` allowlists. It preserves npm’s default contents when no allowlist exists. It also synchronizes selected repository exports. Review the diff and inspect the packed archive through the library’s release checks.

### 3. Review and check

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: @tanstack/intent@latest maintainer review --json
solid: @tanstack/intent@latest maintainer review --json
vue: @tanstack/intent@latest maintainer review --json
svelte: @tanstack/intent@latest maintainer review --json
angular: @tanstack/intent@latest maintainer review --json
lit: @tanstack/intent@latest maintainer review --json

<!-- ::end:tabs -->

Save the report under `.intent/`, assess the pending items, and annotate completed outcomes with their reasons and actual evidence. Record the report with `intent maintainer review --record <report.json>`, then run `intent maintainer check`. This checks skill structure, registration, generated files, and pending reviews together. See the [source-review reference](./cli/intent-review) for report fields and recording.

### 4. Publish

Publish through your library's normal release process.

The registry discovers your package on its next sync cycle. Your skills, version history, and download stats appear on the registry automatically.

A passing structural check alone does not establish that the consumer can complete the task. Include that task evidence in the library's release review.

## Keeping skills current

Use `maintainer review` and `stale` as separate checks as the library changes. `setup` optionally installs their CI workflow:

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: @tanstack/intent@latest maintainer review
solid: @tanstack/intent@latest maintainer review
vue: @tanstack/intent@latest maintainer review
svelte: @tanstack/intent@latest maintainer review
angular: @tanstack/intent@latest maintainer review
lit: @tanstack/intent@latest maintainer review

<!-- ::end:tabs -->

Uses Git changes and recorded content fingerprints to identify skills, planning records, and unmapped source areas that need semantic review. Record completed outcomes with their evidence in `.intent/review-state.json`; missing evidence remains pending.

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: @tanstack/intent@latest stale
solid: @tanstack/intent@latest stale
vue: @tanstack/intent@latest stale
svelte: @tanstack/intent@latest stale
angular: @tanstack/intent@latest stale
lit: @tanstack/intent@latest stale

<!-- ::end:tabs -->

Reports conservative package and release signals: version drift, missing stored source SHAs, artifact warnings, and package coverage. It does not compare source diffs. Flagged text reports include the focused authoring command so your agent can investigate the evidence and return a reviewable update or an explained no-op.

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: @tanstack/intent@latest setup
solid: @tanstack/intent@latest setup
vue: @tanstack/intent@latest setup
svelte: @tanstack/intent@latest setup
angular: @tanstack/intent@latest setup
lit: @tanstack/intent@latest setup

<!-- ::end:tabs -->

Copies the generated CI workflow into your repository. Pull requests validate skills and check recorded source reviews when maintainer guidance or review state exists. Release and manual runs use recorded review state when available, with conservative `stale` signals as the fallback.

> [!NOTE]
> Maintainers use `maintainer setup`, `add`, `status`, `sync`, `review`, and `check` throughout the workflow. Consumers choose their installer: Intent for installed package guidance, or the generated GitHub/plugin commands for selected repository skills. See [repository distribution](./cli/intent-maintainer#choose-repository-distribution).

## Requesting a library

If you use a library that doesn't ship skills yet, the best path is to open an issue on that library's repo pointing them here. The maintainer is the right person to author and own skills for their tool — they know the intent behind the API better than anyone.

You can also point them to the [Agent Skills spec](https://agentskills.io) and the [TanStack Intent overview](/intent/latest/docs/overview) for context.
