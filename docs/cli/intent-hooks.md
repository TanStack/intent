---
title: intent hooks
id: intent-hooks
---

`intent hooks install` installs lifecycle hooks that surface available Intent skills and enforce loading matching guidance before edits in supported agents.

```bash
npx @tanstack/intent@latest hooks install [--scope project|user] [--agents copilot,claude,codex|all]
```

## Options

- `--scope <scope>`: hook install scope, either `project` or `user`; defaults to `project`
- `--agents <agents>`: comma-separated hook agents to configure (`copilot`, `claude`, `codex`) or `all`; defaults to `all`

## Behavior

- Installs hook behavior without writing an `intent-skills` guidance block.
- Adds a session-start skill catalog for supported agents so the agent sees available `skill-id: description` entries before it starts work.
- Keeps edit enforcement in place: supported edit tools are blocked until the agent runs `intent load <skill-id>` for matching guidance.
- `--scope project` writes project-local hook config for agents that support it.
- `--scope user` writes user-level agent config and stores runner scripts under `~/.tanstack/intent/hooks`.
- `--agents all` is the default. In project scope, Copilot is skipped because the supported Copilot CLI hook location is user-scoped.
- Run `intent install` separately when you also want to write project guidance.
- Use `package.json#intent.skills` and `package.json#intent.exclude` to control which skills are surfaced in the session catalog.

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
