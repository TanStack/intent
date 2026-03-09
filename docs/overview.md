---
title: Overview
id: overview
---

`@tanstack/intent` is a CLI for shipping and consuming Agent Skills as package artifacts.

Skills are published with npm packages, discovered from installed dependencies, and mapped into agent configuration in a reviewable way.

## What Intent is for

Intent supports two workflows:

- **Consumers (app teams):** discover skills in `node_modules` and map them into your agent config.
- **Maintainers (library teams):** scaffold skill content, validate it, and ship it in the same release + CI pipeline as code.

Across both workflows, the core capabilities are:

- **Discovery:** find intent-enabled packages and their skills.
- **Configuration:** generate instructions for an `intent-skills` mapping block.
- **Authoring + validation:** scaffold skills and enforce `SKILL.md` + packaging rules.
- **Staleness checks:** detect drift between skill metadata, source, and published versions.

## Choose your path

If you are consuming libraries:

- Start with [Installation](./getting-started/installation.md)
- Then run [Quick Start (Consumers)](./getting-started/quick-start-consumers.md)
- Use [Setting Up Agent Config](./guides/consumers/agent-config-setup.md) and [Listing & Inspecting Skills](./guides/consumers/listing-skills.md) for ongoing usage

If you are publishing libraries:

- Start with [Installation](./getting-started/installation.md)
- Then run [Quick Start (Maintainers)](./getting-started/quick-start-maintainers.md)
- Use [Scaffolding Skills](./guides/maintainers/scaffolding-skills.md), [Validation](./guides/maintainers/validation.md), and [CI Integration](./guides/maintainers/ci-integration.md)

## Core commands

- `npx @tanstack/intent@latest list` discovers installed skills (`--json` for script output)
- `npx @tanstack/intent@latest install` prints instructions for updating `intent-skills` mappings
- `npx @tanstack/intent@latest scaffold` and `npx @tanstack/intent@latest validate` drive skill authoring + checks
- `npx @tanstack/intent@latest stale` reports version/source drift

For complete command details, use the [CLI Reference](./cli/intent-list.md).

## Where to go deeper

- **Concepts:** [What Are Skills](./concepts/what-are-skills.md), [Discovery](./concepts/discovery.md), [Staleness & Versioning](./concepts/staleness.md)
- **Specification:** [package.json Configuration](./specification/package-json.md), [SKILL.md Format](./specification/skill-format.md)
