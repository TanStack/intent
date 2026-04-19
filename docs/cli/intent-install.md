---
title: intent install
id: intent-install
---

`intent install` creates or updates an `intent-skills` mapping block in a project guidance file.

```bash
npx @tanstack/intent@latest install [--dry-run] [--print-prompt] [--global] [--global-only]
```

## Options

- `--dry-run`: print the generated mapping block without writing files
- `--print-prompt`: print the agent setup prompt instead of writing files
- `--global`: include global packages after project packages
- `--global-only`: install mappings from global packages only

## Behavior

- Scans project-local packages by default.
- Includes global packages only when `--global` or `--global-only` is passed.
- Creates `AGENTS.md` when actionable skills are found and no managed block exists.
- Updates an existing managed block in a supported config file.
- Preserves all content outside the managed block.
- Skips reference, meta, maintainer, and maintainer-only skills.
- Writes compact `when` and `use` entries instead of load paths.
- Verifies the managed block before reporting success.
- Prints `No actionable intent skills found.` and does not create a config file when no actionable skills are discovered.

Supported config files: `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.github/copilot-instructions.md`.

## Output

The generated block uses compact skill identities:

```yaml
<!-- intent-skills:start -->
# Skill mappings - resolve `use` with `npx @tanstack/intent@latest resolve <use>`.
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
- No actionable skills: `No actionable intent skills found.`

## Related

- [intent list](./intent-list)
- [intent resolve](./intent-resolve)
- [Quick Start for Consumers](../getting-started/quick-start-consumers)
