---
title: intent hooks
id: intent-hooks
---

`intent hooks install` installs lifecycle hooks that surface available Intent skills and gate supported edit tools until they observe an Intent guidance check.

```bash
npx @tanstack/intent@latest hooks install [--scope project|user] [--agents copilot,claude,codex|all]
```

## Options

- `--scope <scope>`: hook install scope, either `project` or `user`; defaults to `project`
- `--agents <agents>`: comma-separated hook agents to configure (`copilot`, `claude`, `codex`) or `all`; defaults to `all`

## Behavior

### Session behavior

- Installs hook behavior without writing an `intent-skills` guidance block.
- Returns a session-start skill catalog as agent context with available `skill-id: description` entries.
- Blocks supported edit tools until the hook observes a recognized `intent list` or `intent load <skill-id>` command. If no listed skill matches the task, the agent can continue without loading one.
- Uses `package.json#intent.skills` and `package.json#intent.exclude` to control which skills appear in the session catalog.

### Installation behavior

- `--scope project` writes project-local hook config for agents that support it.
- `--scope user` writes user-level agent config and stores runner scripts under `~/.tanstack/intent/hooks`.
- `--agents all` is the default. In project scope, Copilot is skipped because the supported Copilot CLI hook location is user-scoped.
- Run `intent install` separately when you also want to write project guidance.

The hook records a recognized list or load command before that command completes.

Hooks do not verify that:

- The command succeeded.
- The selected skill matched the task.
- The agent received the returned content.
- The model applied the guidance.

Hook output is an edit gate and observation signal, not proof of activation or correct agent behavior. See [Lifecycle boundaries](../concepts/trust-model#lifecycle-boundaries).

## Hook support

| Agent | Project scope | User scope | Hooks installed |
| --- | --- | --- | --- |
| Claude Code | `.claude/settings.json` | `~/.claude/settings.json` | `SessionStart` skill catalog plus `PreToolUse` edit gate |
| Codex | `.codex/hooks.json` | `~/.codex/hooks.json` | `SessionStart` skill catalog plus `PreToolUse` edit gate; Codex hook interception is not a complete security boundary |
| GitHub Copilot CLI | Guidance via `.github/copilot-instructions.md`; blocking hooks are not project-scoped | `$COPILOT_HOME/hooks/hooks.json` or `~/.copilot/hooks/hooks.json` | `SessionStart` skill catalog plus `PreToolUse` edit gate in user scope |
| Cursor | Guidance only | Guidance only | Use `AGENTS.md` or Cursor rules; no blocking hook is installed |
| Generic `AGENTS.md` agents | Guidance only | Guidance only | Use the `intent-skills` guidance block; no blocking hook is installed |

`.github/copilot-instructions.md` is a supported project guidance target for `intent install`. GitHub Copilot CLI hook enforcement uses the user-scoped Copilot hooks directory because that is the supported hook location.

Codex requires users to review and trust non-managed hooks before they run. If Codex reports hooks awaiting review, open its hook browser and trust the generated Intent hook.

## Status messages

- Hook installed: `Installed Intent hooks for claude (project) in .claude/settings.json.`
- Hook skipped: `Skipped Intent hooks for copilot: project scope is not supported; use --scope user`

## Related

- [intent install](./intent-install)
- [intent list](./intent-list)
- [intent load](./intent-load)
