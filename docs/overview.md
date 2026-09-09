---
title: Overview
id: overview
---

`@tanstack/intent` is a CLI for shipping and consuming Agent Skills as package artifacts.

Skills are markdown documents that teach AI coding agents how to use your library correctly. Intent versions them with your releases and ships them inside npm packages. It discovers skills from project and workspace dependencies, then provides commands and guidance for loading them.

## What Intent does

Intent provides tooling for two workflows:

**For consumers:**

- Discover skills from your project and workspace dependencies
- Control which packages' skills are surfaced with an allowlist
- Add lightweight skill loading guidance to your agent config
- Add session catalogs and edit gates for supported agents
- Use skills packaged with installed library versions

**For maintainers (library teams):**

- Add a persistent skill-authoring and review procedure to repository instructions
- Create or update focused skill guidance with an existing coding agent
- Record source-aware review outcomes as the library changes
- Validate SKILL.md format and packaging
- Ship skills in the same release pipeline as code
- Review version, source, artifact, and package coverage signals

## Keep the workflow boundaries clear

| Stage | Who runs it | Result |
| --- | --- | --- |
| Maintainer enablement | Library maintainer | `maintainer setup` creates missing records and installs persistent authoring instructions. |
| Authoring and maintenance | Library maintainer and coding agent | `meta generate-skill` guides a focused batch; `maintainer review` records evidence-backed outcomes for later source changes. |
| Package publishing | Library release process | `maintainer sync` updates package and selected repository exports; `setup` optionally adds CI. |
| Consumer setup | Developer using the published library | Consumer `install` configures permitted skill sources and skill-loading guidance; `list` and `load` use skills from installed dependencies. |

> [!NOTE]
> Maintainer installation and consumer installation write separate managed guidance blocks. Neither command publishes a package or installs a dependency.

## How it works

### Discovery and installation

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: @tanstack/intent@latest list
solid: @tanstack/intent@latest list
vue: @tanstack/intent@latest list
svelte: @tanstack/intent@latest list
angular: @tanstack/intent@latest list
lit: @tanstack/intent@latest list

<!-- ::end:tabs -->

Scans the current project's installed dependencies for intent-enabled packages, including `node_modules`, workspace dependencies, and Yarn PnP projects without `node_modules`. You can narrow which packages are surfaced with `package.json#intent.skills`. See the [Trust model](./concepts/trust-model) and [Configuration](./concepts/configuration) for how the allowlist works. Global package scanning is explicit; pass `--global` to include global packages or `--global-only` to ignore local packages. When both local and global packages are scanned, local packages take precedence.

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: @tanstack/intent@latest install
solid: @tanstack/intent@latest install
vue: @tanstack/intent@latest install
svelte: @tanstack/intent@latest install
angular: @tanstack/intent@latest install
lit: @tanstack/intent@latest install

<!-- ::end:tabs -->

Creates or updates lightweight `intent-skills` guidance in your config files (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`, etc.). Existing guidance is updated in place; otherwise `AGENTS.md` is the default target. Pass `--map` to opt in to explicit task-to-skill mappings.

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: @tanstack/intent@latest hooks install
solid: @tanstack/intent@latest hooks install
vue: @tanstack/intent@latest hooks install
svelte: @tanstack/intent@latest hooks install
angular: @tanstack/intent@latest hooks install
lit: @tanstack/intent@latest hooks install

<!-- ::end:tabs -->

Installs session catalogs and edit gates for supported agents. Project-scoped hooks are available for Claude Code and Codex. GitHub Copilot CLI project guidance can live in `.github/copilot-instructions.md`, while blocking hooks are user-scoped. Cursor and generic `AGENTS.md` agents use guidance only. See [intent hooks](./cli/intent-hooks) for what hooks can observe.

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: @tanstack/intent@latest load @tanstack/query#fetching
solid: @tanstack/intent@latest load @tanstack/query#fetching
vue: @tanstack/intent@latest load @tanstack/query#fetching
svelte: @tanstack/intent@latest load @tanstack/query#fetching
angular: @tanstack/intent@latest load @tanstack/query#fetching
lit: @tanstack/intent@latest load @tanstack/query#fetching

<!-- ::end:tabs -->

Loads the matching `SKILL.md` content for the installed package version. Pass `--path` when you need the resolved skill file path for debugging.

### Maintainer authoring and review

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: @tanstack/intent@latest maintainer setup
solid: @tanstack/intent@latest maintainer setup
vue: @tanstack/intent@latest maintainer setup
svelte: @tanstack/intent@latest maintainer setup
angular: @tanstack/intent@latest maintainer setup
lit: @tanstack/intent@latest maintainer setup

<!-- ::end:tabs -->

Creates missing planning records and installs the authoring procedure in repository instructions. It explains the distribution choice and remembers selected public skills or an opt-out. Skills stay in their owning packages. See the [maintainer quick start](./getting-started/quick-start-maintainers).

Use `maintainer add` to create or register an agreed skill, then author its guidance and task evidence with your coding agent. During later library work:

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: @tanstack/intent@latest maintainer status
react: @tanstack/intent@latest maintainer sync
react: @tanstack/intent@latest maintainer review --json
solid: @tanstack/intent@latest maintainer status
solid: @tanstack/intent@latest maintainer sync
solid: @tanstack/intent@latest maintainer review --json
vue: @tanstack/intent@latest maintainer status
vue: @tanstack/intent@latest maintainer sync
vue: @tanstack/intent@latest maintainer review --json
svelte: @tanstack/intent@latest maintainer status
svelte: @tanstack/intent@latest maintainer sync
svelte: @tanstack/intent@latest maintainer review --json
angular: @tanstack/intent@latest maintainer status
angular: @tanstack/intent@latest maintainer sync
angular: @tanstack/intent@latest maintainer review --json
lit: @tanstack/intent@latest maintainer status
lit: @tanstack/intent@latest maintainer sync
lit: @tanstack/intent@latest maintainer review --json

<!-- ::end:tabs -->

The commands identify work, align generated metadata, and prepare source-review evidence. Record justified outcomes with `maintainer review --record <report.json>` and finish with `maintainer check`. Content changes reopen review. The [maintainer command reference](./cli/intent-maintainer) covers the full workflow, package ownership, and consumer installer choices. Full-library research remains available through the meta-skills when requested.

### Staleness tracking

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: @tanstack/intent@latest stale
solid: @tanstack/intent@latest stale
vue: @tanstack/intent@latest stale
svelte: @tanstack/intent@latest stale
angular: @tanstack/intent@latest stale
lit: @tanstack/intent@latest stale

<!-- ::end:tabs -->

Reports version drift and source, artifact, or package coverage signals that may require skill review. Flagged text reports and generated review PR prompts route your agent to the same focused authoring procedure. The agent checks the source evidence before deciding whether guidance needs to change.
