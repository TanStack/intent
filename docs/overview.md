---
title: Overview
id: overview
---

`@tanstack/intent` is a CLI for shipping and consuming Agent Skills as package artifacts.

Skills are markdown documents that teach AI coding agents how to use your library correctly. Intent versions them with your releases and ships them inside npm packages. It discovers skills from your project and workspace dependencies, then helps agents load them when working on matching tasks.

## What Intent does

Intent provides tooling for two workflows:

**For consumers:**

- Discover skills from your project and workspace dependencies
- Control which packages' skills are surfaced with an allowlist
- Add lightweight skill loading guidance to your agent config
- Add hook enforcement for agents that support blocking lifecycle hooks
- Keep skills synchronized with library versions

**For maintainers (library teams):**

- Scaffold skills through AI-assisted domain discovery
- Validate SKILL.md format and packaging
- Ship skills in the same release pipeline as code
- Track staleness when source docs change

## How it works

### Discovery and installation

Examples use `npx` for npm projects. In pnpm, Yarn, or Bun projects, use the matching runner:

| Tool | Pattern                                      |
| ---- | -------------------------------------------- |
| npm  | `npx @tanstack/intent@latest <command>`      |
| pnpm | `pnpm dlx @tanstack/intent@latest <command>` |
| Yarn | `yarn dlx @tanstack/intent@latest <command>` |
| Bun  | `bunx @tanstack/intent@latest <command>`     |

```bash
npx @tanstack/intent@latest list
```

Scans the current project's installed dependencies for intent-enabled packages, including `node_modules`, workspace dependencies, and Yarn PnP projects without `node_modules`. You can narrow which packages are surfaced with `package.json#intent.skills`. See the [Trust model](./concepts/trust-model) and [Configuration](./concepts/configuration) for how the allowlist works.
Global package scanning is explicit; pass `--global` to include global packages or `--global-only` to ignore local packages.
When both local and global packages are scanned, local packages take precedence.

```bash
npx @tanstack/intent@latest install
```

Creates or updates lightweight `intent-skills` guidance in your config files (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`, etc.). Existing guidance is updated in place; otherwise `AGENTS.md` is the default target. Pass `--map` to opt in to explicit task-to-skill mappings.

```bash
npx @tanstack/intent@latest hooks install
```

Installs hook enforcement for supported agents. Project-scoped hooks are available for Claude Code and Codex. GitHub Copilot CLI project guidance can live in `.github/copilot-instructions.md`, while blocking hooks are user-scoped. Cursor and generic `AGENTS.md` agents use guidance only.

```bash
npx @tanstack/intent@latest load @tanstack/query#fetching
```

Loads the matching `SKILL.md` content for the installed package version. Pass `--path` when you need the resolved skill file path for debugging.

### Scaffolding and validation

```bash
npx @tanstack/intent@latest scaffold
```

Guides your agent through domain discovery, tree generation, and skill authoring with interactive maintainer interviews.

```bash
npx @tanstack/intent@latest validate
```

Enforces SKILL.md format rules and packaging requirements before publish.

### Staleness tracking

```bash
npx @tanstack/intent@latest stale
```

Detects when skills reference outdated source documentation or library versions.
