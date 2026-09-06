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
| Maintainer enablement | Library maintainer | `install --maintainer` writes an `intent-maintainer` block to repository agent instructions. |
| Authoring and maintenance | Library maintainer and coding agent | `generate-skill` creates or updates a focused batch; `review` records evidence-backed outcomes for later source changes. |
| Package publishing | Library release process | `edit-package-json` includes skills in the package and `setup` optionally adds the generated GitHub Actions workflow. |
| Consumer setup | Developer using the published library | Consumer `install` configures permitted skill sources and skill-loading guidance; `list` and `load` use skills from installed dependencies. |

> [!NOTE]
> Maintainer installation and consumer installation write separate managed guidance blocks. Neither command publishes a package or installs a dependency.

## How it works

### Discovery and installation

Use the runner for your package manager:

| Tool | Pattern                                      |
| ---- | -------------------------------------------- |
| npm  | `npx @tanstack/intent@latest <command>`      |
| pnpm | `pnpm dlx @tanstack/intent@latest <command>` |
| Yarn | `yarn dlx @tanstack/intent@latest <command>` |
| Bun  | `bunx @tanstack/intent@latest <command>`     |

```bash
npx @tanstack/intent@latest list
```

Scans the current project's installed dependencies for intent-enabled packages, including `node_modules`, workspace dependencies, and Yarn PnP projects without `node_modules`. You can narrow which packages are surfaced with `package.json#intent.skills`. See the [Trust model](./concepts/trust-model) and [Configuration](./concepts/configuration) for how the allowlist works. Global package scanning is explicit; pass `--global` to include global packages or `--global-only` to ignore local packages. When both local and global packages are scanned, local packages take precedence.

```bash
npx @tanstack/intent@latest install
```

Creates or updates lightweight `intent-skills` guidance in your config files (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`, etc.). Existing guidance is updated in place; otherwise `AGENTS.md` is the default target. Pass `--map` to opt in to explicit task-to-skill mappings.

```bash
npx @tanstack/intent@latest hooks install
```

Installs session catalogs and edit gates for supported agents. Project-scoped hooks are available for Claude Code and Codex. GitHub Copilot CLI project guidance can live in `.github/copilot-instructions.md`, while blocking hooks are user-scoped. Cursor and generic `AGENTS.md` agents use guidance only. See [intent hooks](./cli/intent-hooks) for what hooks can observe.

```bash
npx @tanstack/intent@latest load @tanstack/query#fetching
```

Loads the matching `SKILL.md` content for the installed package version. Pass `--path` when you need the resolved skill file path for debugging.

### Maintainer authoring and review

```bash
npx @tanstack/intent@latest install --maintainer
```

Adds repository instructions that route substantial library changes through the packaged authoring procedure and `intent review`. It does not configure consumer permissions, hooks, publishing, or CI. See the [maintainer quick start](./getting-started/quick-start-maintainers).

```bash
npx @tanstack/intent@latest scaffold
```

Prints the focused authoring entry point for a current agent conversation without installing persistent maintainer instructions. Full-library discovery and its maintainer interviews remain available when explicitly requested.

```bash
npx @tanstack/intent@latest review
```

Reports skills, planning records, and changed source areas that need review. Completed outcomes are recorded in `.intent/review-state.json` and reopen when their tracked content changes. The agent and maintainer supply the semantic decision and evidence.

```bash
npx @tanstack/intent@latest validate
```

Checks SKILL.md format rules and reports packaging warnings before publish.

### Staleness tracking

```bash
npx @tanstack/intent@latest stale
```

Reports version drift and source, artifact, or package coverage signals that may require skill review. Flagged text reports and generated review PR prompts route your agent to the same focused authoring procedure. The agent checks the source evidence before deciding whether guidance needs to change.
