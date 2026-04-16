---
title: Quick Start for Consumers
id: quick-start-consumers
---

Get started using Intent to set up skill-to-task mappings for your agent.

## 1. Run install

The install command guides your agent through the setup process:

```bash
npx @tanstack/intent@latest install
```

This creates or updates an `intent-skills` block. It:

1. Check for existing `intent-skills` mappings in your config files (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`, etc.)
2. Run a local package scan to discover available skills from installed packages
3. Write compact mappings for actionable skills
4. Preserve content outside the managed block
5. Verify the managed block before reporting success

If an `intent-skills` block already exists, Intent updates that file in place.
If no block exists, `AGENTS.md` is the default target.

Intent creates mappings like:

```markdown
<!-- intent-skills:start -->
# Skill mappings - resolve `use` with `npx @tanstack/intent@latest resolve <use>`.
skills:
  - when: "Query data fetching patterns"
    use: "@tanstack/react-query#core"
  - when: "Router patterns"
    use: "@tanstack/react-router#core"
<!-- intent-skills:end -->
```

## 2. Use skills in your workflow

When your agent works on a task that matches a mapping, it resolves the compact `use` value and loads the matching SKILL.md into context.

Resolve a mapping manually:

```bash
npx @tanstack/intent@latest resolve @tanstack/react-query#core
```

This prints the skill file path for the installed package version.

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




