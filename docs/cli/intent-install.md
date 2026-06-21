---
title: intent install
id: intent-install
---

`intent install` creates or updates an `intent-skills` guidance block in a project guidance file. Pass `--hooks` to also install lifecycle hooks that enforce loading matching guidance before edits in supported agents.

```bash
npx @tanstack/intent@latest install [--map] [--hooks] [--scope project|user] [--agents copilot,claude,codex|all] [--dry-run] [--print-prompt] [--global] [--global-only] [--no-notices]
```

## Options

- `--map`: write explicit task-to-skill mappings instead of lightweight loading guidance
- `--hooks`: install agent lifecycle hooks that block edits until matching Intent guidance is loaded
- `--scope <scope>`: hook install scope, either `project` or `user`; defaults to `project`
- `--agents <agents>`: comma-separated hook agents to configure (`copilot`, `claude`, `codex`) or `all`; defaults to `all`
- `--dry-run`: print the generated block without writing files
- `--print-prompt`: print the agent setup prompt instead of writing files
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
- Installs hook enforcement only when `--hooks` is passed.
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

## Hook enforcement

`--hooks` installs local lifecycle hooks that observe `intent load` commands and block edit tools until guidance has been loaded in the current agent session.

```bash
npx @tanstack/intent@latest install --hooks
npx @tanstack/intent@latest install --hooks --agents claude,codex
npx @tanstack/intent@latest install --hooks --scope user --agents copilot
```

Default hook behavior:

- `--scope project` is the default. It writes project-local hook config for agents that support it.
- `--agents all` is the default. In project scope, Copilot is skipped because the supported Copilot CLI hook location is user-scoped.
- `--scope user` writes user-level agent config and stores runner scripts under `~/.tanstack/intent/hooks`.
- `--dry-run` prints the generated guidance block and does not write hook config.

Hook support:

| Agent | Project scope | User scope | Enforcement |
| --- | --- | --- | --- |
| Claude Code | `.claude/settings.json` | `~/.claude/settings.json` | Blocks configured edit tools with `PreToolUse` |
| Codex | `.codex/hooks.json` | `~/.codex/hooks.json` | Blocks supported `Bash`, `apply_patch`, and MCP tool calls; Codex hook interception is not a complete security boundary |
| GitHub Copilot CLI | Not supported | `$COPILOT_HOME/hooks/hooks.json` or `~/.copilot/hooks/hooks.json` | Blocks supported edit tools with `PreToolUse` |
| Cursor | Guidance only | Guidance only | Use `AGENTS.md` or Cursor rules; no blocking hook is installed |
| Generic `AGENTS.md` agents | Guidance only | Guidance only | Use the `intent-skills` guidance block; no blocking hook is installed |

Codex requires users to review and trust non-managed hooks before they run. If Codex reports hooks awaiting review, open its hook browser and trust the generated Intent hook.

## Add another coding platform

Intent can support any coding agent that exposes a lifecycle hook before file edits or shell commands run. A good platform adapter needs three pieces:

1. A hook event that runs before edits, ideally before tools like `Write`, `Edit`, `apply_patch`, or notebook edits execute.
2. Access to the pending tool name and command or edit input, so the hook can observe `intent load <package>#<skill>` and block edits until a load has happened in the session.
3. A documented way to return a blocking decision with a message the agent can see.

The shared policy is intentionally small: observe `intent load`, remember that the current session loaded guidance, and deny edit tools until that happens. Platform adapters should only translate that policy into the platform's hook config, event shape, and denial response.

If your coding platform has a compatible hook API, open a PR with:

- an adapter entry in `packages/intent/src/hooks/adapters.ts`
- config generation in `packages/intent/src/hooks/install.ts`
- tests for config generation and deny/allow behavior
- a row in the support table above
- links to the platform's public hook documentation

If the platform only supports prompt instructions, use the `intent-skills` guidance block instead of claiming hook enforcement.

## Status messages

- Created: `Created AGENTS.md with 1 mapping.`
- Updated: `Updated AGENTS.md with 2 mappings.`
- Unchanged: `No changes to AGENTS.md; 2 mappings already current.`
- Guidance created: `Created AGENTS.md with skill loading guidance.`
- Guidance unchanged: `No changes to AGENTS.md; skill loading guidance already current.`
- Placement tip: `Tip: Keep the intent-skills block near the top of AGENTS.md so agents read it before task-specific instructions.`
- No actionable skills in `--map` mode: `No intent-enabled skills found.`
- Hook installed: `Installed Intent hooks for claude (project) in .claude/settings.json.`
- Hook skipped: `Skipped Intent hooks for copilot: project scope is not supported; use --scope user`

To suppress trust and migration notices in automation, pass `--no-notices`.

## Related

- [intent list](./intent-list)
- [intent load](./intent-load)
- [Quick Start for Consumers](../getting-started/quick-start-consumers)
