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

This prints a skill that instructs your AI agent to:
1. Check for existing `intent-skills` mappings in your config files (CLAUDE.md, .cursorrules, etc.)
2. Run `intent list` to discover available skills from installed packages
3. Scan your repository structure to understand your project
4. Propose relevant skill-to-task mappings based on your codebase patterns
5. Write or update an `intent-skills` block in your agent config

Your agent will create mappings like:

```markdown
<!-- intent-skills:start -->
# Skill mappings — when working in these areas, load the linked skill file into context.
skills:
  - task: "implementing data fetching with TanStack Query"
    load: "node_modules/@tanstack/react-query/skills/core/SKILL.md"
  - task: "setting up routing with TanStack Router"
    load: "node_modules/@tanstack/react-router/skills/core/SKILL.md"
<!-- intent-skills:end -->
```

## 2. Use skills in your workflow

When your agent works on a task that matches a mapping, it automatically loads the corresponding SKILL.md into context to guide implementation.

## 3. Keep skills up-to-date

Skills version with library releases. When you update a library:

```bash
npm update @tanstack/react-query
```

The new version brings updated skills automatically — you don't need to do anything. The skills are shipped with the library, so you always get the version that matches your installed code.

If you need to see what skills have changed, run:

```bash
npx @tanstack/intent@latest list
```

Or use `--json` for machine-readable output:

```bash
npx @tanstack/intent@latest list --json
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

---

## Next steps

- [Listing Skills](../guides/consumers/listing-skills.md) — interpret `intent list` output in detail
- [Submitting Feedback](../guides/consumers/submitting-feedback.md) — help maintainers improve skills
- [What Are Skills](../concepts/what-are-skills.md) — understand skill anatomy and consumption





