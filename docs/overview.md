---
title: Overview
id: overview
---

`@tanstack/intent` is a CLI for shipping and consuming Agent Skills as package artifacts.

Skills are markdown documents that teach AI coding agents how to use your library correctly. Intent versions them with your releases, ships them inside npm packages, discovers them from `node_modules`, and helps agents load them automatically when working on matching tasks.

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

Scans `node_modules` for intent-enabled packages and shows available skills with paths and descriptions.

```bash
npx @tanstack/intent@latest install
```

Prints instructions for your agent to create `intent-skills` mappings in your config files (CLAUDE.md, .cursorrules, etc.).

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
