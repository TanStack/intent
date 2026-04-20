---
title: Quick Start for Consumers
id: quick-start-consumers
---

Get started using Intent to help your agent discover and load package skills.

## 1. Run install

The install command guides your agent through the setup process:

```bash
npx @tanstack/intent@latest install
```

This creates or updates an `intent-skills` guidance block. It:

1. Checks for existing `intent-skills` guidance in your config files (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`, etc.)
2. Writes lightweight instructions for skill discovery and loading
3. Preserves content outside the managed block
4. Verifies the managed block before reporting success

If an `intent-skills` block already exists, Intent updates that file in place.
If no block exists, `AGENTS.md` is the default target.

Intent creates guidance like:

```markdown
<!-- intent-skills:start -->
## Skill Loading

Before substantial work:
- Skill check: run `npx @tanstack/intent@latest list`, or use skills already listed in context.
- Skill guidance: if one local skill clearly matches the task, run `npx @tanstack/intent@latest load <package>#<skill>` and follow the returned `SKILL.md`.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.
<!-- intent-skills:end -->
```

## 2. Use skills in your workflow

When your agent works on a task that matches an available skill, it loads the matching `SKILL.md` into context.

Load a skill manually:

```bash
npx @tanstack/intent@latest load @tanstack/react-query#core
```

This prints the skill content for the installed package version.

If you want explicit task-to-skill mappings in your agent config, opt in:

```bash
npx @tanstack/intent@latest install --map
```

## 3. Keep skills up-to-date

Skills version with library releases. When you update a library:

```bash
npm update @tanstack/react-query
```

The new version brings updated skills automatically. The skills are shipped with the library, so you get the version that matches your installed code. If a package is installed both locally and globally and global scanning is enabled, Intent prefers the local version.

If you need to see what skills have changed, run:

```bash
npx @tanstack/intent@latest list
```

Use `--json` for machine-readable output:

```bash
npx @tanstack/intent@latest list --json
```

Global package scanning is opt-in:

```bash
npx @tanstack/intent@latest list --global
```

You can also check if any skills reference outdated source documentation:

```bash
npx @tanstack/intent@latest stale
```

## 4. Submit feedback (optional)

After using a skill, you can submit feedback to help maintainers improve it:

```bash
npx @tanstack/intent@latest meta feedback-collection
```

This prints a skill that guides your agent to collect structured feedback about gaps, errors, and improvements.
