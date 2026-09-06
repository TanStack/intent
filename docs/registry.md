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

react: @tanstack/intent@latest install --maintainer
solid: @tanstack/intent@latest install --maintainer
vue: @tanstack/intent@latest install --maintainer
svelte: @tanstack/intent@latest install --maintainer
angular: @tanstack/intent@latest install --maintainer
lit: @tanstack/intent@latest install --maintainer

<!-- ::end:tabs -->

Then ask your coding agent for a useful batch of developer tasks. The installed instructions load the focused authoring procedure, maintain the shared planning record, and run source-aware review before handoff.

For a one-off authoring session, tell the agent to run:

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: @tanstack/intent@latest scaffold
solid: @tanstack/intent@latest scaffold
vue: @tanstack/intent@latest scaffold
svelte: @tanstack/intent@latest scaffold
angular: @tanstack/intent@latest scaffold
lit: @tanstack/intent@latest scaffold

<!-- ::end:tabs -->

Give the agent a developer task or concrete code/docs change. The focused procedure creates or updates the relevant guidance and validates it for review; full-library discovery remains available when explicitly requested. Skills use the owning package's `skills/` directory or its existing custom root. See the [maintainer quick start](./getting-started/quick-start-maintainers).

### 2. Validate

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: @tanstack/intent@latest validate
solid: @tanstack/intent@latest validate
vue: @tanstack/intent@latest validate
svelte: @tanstack/intent@latest validate
angular: @tanstack/intent@latest validate
lit: @tanstack/intent@latest validate

<!-- ::end:tabs -->

Catches structural issues in skill frontmatter and planning artifacts, and reports package configuration warnings before you publish.

### 3. Configure the package

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: @tanstack/intent@latest edit-package-json
solid: @tanstack/intent@latest edit-package-json
vue: @tanstack/intent@latest edit-package-json
svelte: @tanstack/intent@latest edit-package-json
angular: @tanstack/intent@latest edit-package-json
lit: @tanstack/intent@latest edit-package-json

<!-- ::end:tabs -->

This adds the `tanstack-intent` keyword used for registry discovery and the `files` entries needed to publish `skills/`. It excludes `skills/_artifacts` from a standalone package; monorepo artifacts live at the repository root, outside package tarballs. Review the resulting `package.json` diff before keeping it.

### 4. Publish

Publish through your library's normal release process.

The registry discovers your package on its next sync cycle. Your skills, version history, and download stats appear on the registry automatically.

## Keeping skills current

Use two separate checks as the library changes:

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: @tanstack/intent@latest review
solid: @tanstack/intent@latest review
vue: @tanstack/intent@latest review
svelte: @tanstack/intent@latest review
angular: @tanstack/intent@latest review
lit: @tanstack/intent@latest review

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
> Authoring, package publishing, and consumer setup are separate. `install --maintainer` writes repository instructions; `edit-package-json` configures the library package; consumers run their own `intent install` after installing the published library.

## Requesting a library

If you use a library that doesn't ship skills yet, the best path is to open an issue on that library's repo pointing them here. The maintainer is the right person to author and own skills for their tool — they know the intent behind the API better than anyone.

You can also point them to the [Agent Skills spec](https://agentskills.io) and the [TanStack Intent overview](/intent/latest/docs/overview) for context.
