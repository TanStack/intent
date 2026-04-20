---
title: intent install
id: intent-install
---

`intent install` creates or updates an `intent-skills` guidance block in a project guidance file.

```bash
npx @tanstack/intent@latest install [--map] [--dry-run] [--print-prompt] [--global] [--global-only]
```

## Options

- `--map`: write explicit task-to-skill mappings instead of lightweight loading guidance
- `--dry-run`: print the generated block without writing files
- `--print-prompt`: print the agent setup prompt instead of writing files
- `--global`: include global packages after project packages when `--map` is passed
- `--global-only`: install mappings from global packages only when `--map` is passed

## Behavior

- Writes lightweight skill loading guidance by default.
- Creates `AGENTS.md` when no managed block exists.
- Updates an existing managed block in a supported config file.
- Preserves all content outside the managed block.
- Scans packages and writes compact `when` and `use` mappings only when `--map` is passed.
- Skips reference, meta, maintainer, and maintainer-only skills in `--map` mode.
- Writes compact `when` and `use` entries instead of load paths in `--map` mode.
- Verifies the managed block before reporting success.
- Prints `No intent-enabled skills found.` and does not create a config file when `--map` finds no actionable skills.

Supported config files: `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.github/copilot-instructions.md`.

## Default output

The default block tells agents to discover skills and load matching guidance on demand:

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

## Mapping output

`--map` writes compact skill identities:

```yaml
<!-- intent-skills:start -->
# Skill mappings - load `use` with `npx @tanstack/intent@latest load <use>`.
skills:
  - when: "Query data fetching patterns"
    use: "@tanstack/query#fetching"
<!-- intent-skills:end -->
```

- `when`: task-routing phrase for agents
- `use`: portable skill identity in `<package>#<skill>` format
- The block does not store `load` paths, absolute paths, or package-manager-internal paths

## Status messages

- Created: `Created AGENTS.md with 1 mapping.`
- Updated: `Updated AGENTS.md with 2 mappings.`
- Unchanged: `No changes to AGENTS.md; 2 mappings already current.`
- Guidance created: `Created AGENTS.md with skill loading guidance.`
- Guidance unchanged: `No changes to AGENTS.md; skill loading guidance already current.`
- Placement tip: `Tip: Keep the intent-skills block near the top of AGENTS.md so agents read it before task-specific instructions.`
- No actionable skills in `--map` mode: `No intent-enabled skills found.`

## Related

- [intent list](./intent-list)
- [intent load](./intent-load)
- [Quick Start for Consumers](../getting-started/quick-start-consumers)
