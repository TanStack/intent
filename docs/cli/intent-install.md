---
title: intent install
id: intent-install
---

`intent install` confirms skill-source permissions on first use, then creates or updates an `intent-skills` guidance block in a project guidance file.

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

### Default install

- When effective `intent.skills` is already configured, keeps the existing guidance-only behavior without prompting or changing `package.json`.
- When effective `intent.skills` is absent, requires an interactive terminal and discovers raw npm and workspace permission candidates.
- Shows package versions, skill descriptions, and excluded candidates before asking about permissions.
- Groups selectable choices by package. Press Space to select or deselect package-wide and exact-skill permissions, then press Enter to review. Package-wide choices include current and future skills; exact choices permit only the named skill.
- Lists excluded packages and skills in the discovery overview and omits them from the picker. The setup does not change `intent.exclude`.
- Asks about allow-all separately, after the discovery overview. Accepting it writes only `["*"]` and skips narrower selection.
- An empty selection previews deny-all (`[]`) and explicitly asks whether to disable all skills. The preview explains that this also blocks future sources until `intent.skills` is edited.
- When no skills are discovered, or all discovered skills are excluded, explains how to retry and writes neither permissions nor guidance. It does not create a deny-all policy from empty discovery.
- Previews the exact `intent.skills` value, destination, and trust change before confirmation.
- Uses a final confirmation that defaults to no. Decline or cancellation at any stage does not write permission or guidance files.
- Fails before discovery and writes when effective `intent.skills` is absent and stdin is not a TTY.
- Updates the nearest `package.json` that owns the current working directory. In a workspace package, this is the package's own `package.json`; inherited policy still bypasses setup.
- Uses a formatting-preserving sibling temporary file and atomic rename. If `package.json` changes after preview, the command fails and asks you to run it again.
- Runs guidance only after permission configuration succeeds or is unchanged.
- Creates `AGENTS.md` when no managed block exists.
- Updates an existing managed block in a supported config file.
- Preserves all content outside the managed block.
- Verifies the managed block before reporting success.
- After confirmed setup, scans with the saved policy and reports the available skill and package counts. Prints a package-manager-aware `list` command when skills are available, or instructions to edit `intent.skills` when none are enabled.

`--dry-run` performs discovery and selection, prints the permission and guidance previews, and writes neither file.

`@tanstack/intent` requires Node.js 20.12.0 or newer.

### Mapping mode

- Scans packages and writes compact `id`, `run`, and `for` mappings only when `--map` is passed.
- Surfaces packages permitted by `package.json#intent.skills` in `--map` mode. See [Configuration](../concepts/configuration).
- Skips reference, meta, maintainer, and maintainer-only skills in `--map` mode.
- Writes compact skill identities and runnable guidance commands instead of local file paths in `--map` mode.
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

| Result | Message |
| --- | --- |
| Mapping created | `Created AGENTS.md with 1 mapping.` |
| Mappings updated | `Updated AGENTS.md with 2 mappings.` |
| Mappings unchanged | `No changes to AGENTS.md; 2 mappings already current.` |
| Guidance created | `Created AGENTS.md with skill loading guidance.` |
| Guidance unchanged | `No changes to AGENTS.md; skill loading guidance already current.` |
| Permissions updated | `Permissions: updated package.json.` |
| Permissions canceled | `Permissions: canceled.` |
| Guidance result after setup | `Guidance: created AGENTS.md.` |
| Guidance failure after setup | `Guidance: failed: <error>` |
| Placement tip | `Tip: Keep the intent-skills block near the top of AGENTS.md so agents read it before task-specific instructions.` |
| No actionable skills in `--map` mode | `No intent-enabled skills found.` |

To suppress trust and migration notices in automation, pass `--no-notices`.

## Related

- [intent list](./intent-list)
- [intent load](./intent-load)
- [intent hooks](./intent-hooks)
- [Quick Start for Consumers](../getting-started/quick-start-consumers)
