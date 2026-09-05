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

If `intent.skills` is already configured, including through workspace inheritance, `install` only updates guidance. It does not prompt or change `package.json`.

Otherwise, first-run setup requires an interactive terminal. Non-TTY execution fails before discovery or writes. Node.js 20.12.0 or newer is required.

#### First-run flow

1. **Choose packages** from a searchable list. Type to filter, use arrow keys to move, Tab to toggle, and Enter to review. Nothing is selected by default.
2. **Review** your choices, with selected packages first. Type to find a package, then press Enter to choose individual skills, remove it, or inspect descriptions and exclusions. Full descriptions appear only when requested.
3. **Confirm** the permission summary and destination file. **Show exact configuration** previews `intent.skills`; **Continue to confirmation** asks before saving and defaults to No.
4. **Finish** with verified guidance, available skill and package counts, and a command to list those skills.

#### Permission choices

| Choice | Effect |
| --- | --- |
| All skills in a package | Permits its current and future skills. |
| Individual skill | Permits only the named skill. |
| Advanced: allow all current and future sources | Separately confirms writing `["*"]`, replacing narrower choices. |
| Select nothing | Explicitly confirms writing `[]`, disabling current and future sources until `intent.skills` is edited. |

Existing `intent.exclude` rules always apply and remain unchanged.

#### Files and retry behavior

Permissions go in the nearest owning `package.json`. Inside a workspace package, this is that package's file. The update preserves formatting and uses an atomic replacement; if the file changes after preview, Intent stops and asks you to retry.

After permissions are saved, Intent updates an existing managed guidance block in a supported config file, or creates one in `AGENTS.md`. Content outside the block is preserved, and the block is verified before success is reported.

- **No skills found, or all excluded:** explains how to retry and writes nothing. Empty discovery does not create a deny-all policy.
- **Decline or cancel a prompt:** writes neither permissions nor guidance.
- **`--dry-run`:** performs discovery and selection, previews permissions and guidance, and writes neither file.

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
