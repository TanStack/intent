---
title: intent install
id: intent-install
---

`intent install` creates or updates an `intent-skills` guidance block in a project guidance file.

```bash
npx @tanstack/intent@latest install [--map] [--dry-run] [--print-prompt] [--global] [--global-only] [--no-notices]
```

## Options

### Guidance output

- `--map`: write explicit task-to-skill mappings instead of lightweight loading guidance
- `--dry-run`: print the generated block without writing files
- `--print-prompt`: print the agent setup prompt instead of writing files

### Mapping scan scope

- `--global`: include global packages after project packages when `--map` is passed
- `--global-only`: install mappings from global packages only when `--map` is passed
- `--no-notices`: suppress non-critical notices on stderr

## Behavior

- Writes lightweight skill loading guidance by default.
- Creates `AGENTS.md` when no managed block exists.
- Updates an existing managed block in a supported config file.
- Preserves all content outside the managed block.
- Scans packages and writes compact `id`, `run`, and `for` mappings only when `--map` is passed.
- Surfaces packages permitted by `package.json#intent.skills` in `--map` mode. See [Configuration](../concepts/configuration).
- Skips reference, meta, maintainer, and maintainer-only skills in `--map` mode.
- Writes compact skill identities and runnable guidance commands instead of local file paths in `--map` mode.
- Verifies the managed block before reporting success.
- Prints `No intent-enabled skills found.` and does not create a config file when `--map` finds no actionable skills.

Supported config files: `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.github/copilot-instructions.md`.

## Default output

The default block tells agents to discover skills and load matching guidance on demand:

```markdown
<!-- intent-skills:start -->
## Skill Loading

Before editing files for a substantial task:
- Run `npx @tanstack/intent@latest list` from the workspace root to see available local skills.
- If a listed skill matches the task, run `npx @tanstack/intent@latest load <package>#<skill>` before changing files.
- Use the loaded `SKILL.md` guidance while making the change.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.
<!-- intent-skills:end -->
```

## Mapping output

`--map` writes compact skill identities and commands:

```yaml
<!-- intent-skills:start -->
# TanStack Intent - before editing files, run the matching guidance command.
tanstackIntent:
  - id: "@tanstack/query#fetching"
    run: "npx @tanstack/intent@latest load @tanstack/query#fetching"
    for: "Query data fetching patterns"
<!-- intent-skills:end -->
```

- `id`: portable skill identity in `<package>#<skill>` format
- `run`: package-manager-aware command agents should run before editing
- `for`: task-routing phrase for agents
- The block does not store `load` paths, absolute paths, or package-manager-internal paths

## Status messages

- Created: `Created AGENTS.md with 1 mapping.`
- Updated: `Updated AGENTS.md with 2 mappings.`
- Unchanged: `No changes to AGENTS.md; 2 mappings already current.`
- Guidance created: `Created AGENTS.md with skill loading guidance.`
- Guidance unchanged: `No changes to AGENTS.md; skill loading guidance already current.`
- Placement tip: `Tip: Keep the intent-skills block near the top of AGENTS.md so agents read it before task-specific instructions.`
- No actionable skills in `--map` mode: `No intent-enabled skills found.`

To suppress trust and migration notices in automation, pass `--no-notices`.

## Related

- [intent list](./intent-list)
- [intent load](./intent-load)
- [intent hooks](./intent-hooks)
- [Quick Start for Consumers](../getting-started/quick-start-consumers)
