---
title: Overview
id: overview
---

`@tanstack/intent` is a CLI for shipping and consuming Agent Skills as package artifacts.

Skills are markdown documents that teach AI coding agents how to use your library correctly. Intent versions them with your releases, ships them inside npm packages, discovers them from your project and workspace by default, and helps agents load them automatically when working on matching tasks.

## What Intent does

Intent provides tooling for two workflows:

**For consumers:**
- Discover skills from installed dependencies
- Generate task-to-skill mappings for your agent config
- Keep skills synchronized with library versions

**For maintainers (library teams):**
- Scaffold skills through AI-assisted domain discovery
- Validate SKILL.md format and packaging
- Ship skills in the same release pipeline as code
- Track staleness when source docs change

## How it works

### Discovery and installation

```bash
npx @tanstack/intent@latest list
```

Scans the current project's `node_modules` and workspace dependencies for intent-enabled packages.
Global package scanning is explicit; pass `--global` to include global packages or `--global-only` to ignore local packages.
When both local and global packages are scanned, local packages take precedence.

```bash
npx @tanstack/intent@latest install
```

Creates or updates compact `intent-skills` mappings in your config files (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`, etc.). Existing mappings are updated in place; otherwise `AGENTS.md` is the default target.

```bash
npx @tanstack/intent@latest resolve @tanstack/query#fetching
```

Resolves a compact `<package>#<skill>` mapping to the installed skill file path. Agents can use this at runtime instead of storing package-manager-specific paths in config files.

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
