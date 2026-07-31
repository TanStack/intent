---
title: Overview
id: overview
---

An Agent Skill is a set of instructions that helps a coding agent work with a library or handle a particular task. `@tanstack/intent` lets libraries include these skills in their packages, so each package version can carry matching guidance.

Skills come from your dependencies, and a skill tells your agent what to do, so Intent only uses skills from the packages you choose to trust. You decide which packages may provide skills and how your agents receive them.

## Use skills from a dependency

If a dependency already includes skills, start with the [consumer quick start](./getting-started/quick-start-consumers). During installation, you approve the packages you trust to provide skills and choose how to deliver those skills to your agents.

Intent records the sources you approved in `package.json`, the accepted skill contents in `intent.lock`, and your local delivery choice in `.intent/delivery.json`. A package that ships skills contributes nothing until you list it among the sources you trust.

Symlink installs use `sync` to keep agent links current, and it flags new or changed skills for review before they reach your agent. Hooks are another delivery option, and a static guidance block can write the skills into a file such as `AGENTS.md`. Read the [trust model](./concepts/trust-model) for how packages and skill changes are approved, or [configuration](./concepts/configuration) for the available settings.

## Publish skills with a library

If you maintain a library, keep its skills in the package alongside the code they describe, so each release ships the guidance written for it. Start with the [maintainer quick start](./getting-started/quick-start-maintainers).

Intent scaffolds skills with your agent, validates their format and packaging before you publish, and reports when a skill looks stale as the library changes. The [registry](./registry) explains how to make a published package discoverable.
