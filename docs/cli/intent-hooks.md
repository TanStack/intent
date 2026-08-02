---
title: intent hooks
id: intent-hooks
---

`intent hooks run` runs the agent lifecycle hook that shows your coding agent which skills are available when a new context starts. You do not usually run it yourself: `intent install` wires it into the agent's supported session and subagent hooks when you choose hook delivery.

<!-- ::start:tabs variant="package-manager" mode="local-install" -->
@tanstack/intent@latest hooks run --agent copilot|claude|codex
<!-- ::end:tabs -->

## Options

- `--agent <agent>`: the agent whose hook format to emit, one of `copilot`, `claude`, or `codex`. Required.

## What it does

At a supported context boundary, the hook prints a short catalogue of the skills your project trusts, each with the command to load it, so the agent knows what is available before it starts work. Claude Code and Codex replay their persisted catalogue on ordinary resumes without reinjecting it. GitHub Copilot CLI reinjects the catalogue when a resumed process starts because its hook context is process-local.

Claude Code and Codex receive the catalogue for new, cleared, and compacted contexts and when a subagent starts. Claude Code also receives it for forked sessions. GitHub Copilot CLI receives it for new and resumed process starts and subagents; its hook API does not provide a post-compaction context event.

The catalogue lists only skills accepted in `intent.lock`, and it is capped to keep sessions small: at most 50 skills and about 8 KB, with long descriptions trimmed. If it cannot build the catalogue it fails open, so the session continues and the hook prints a note to run `intent catalog` outside the session to see why.

Hooks surface skills; they do not block edits. They are a convenience for getting skills in front of your agent, not a security boundary - the trust guarantees come from the source policy and the lockfile. See the [trust model](../concepts/trust-model).

## Installing hooks

Choose hook delivery when you run [`intent install`](./intent-install). Because the supported hook locations live in your home directory, these hooks are user-scoped and apply across your repositories, so `install` asks before writing them. It configures the supported session and subagent hooks for the agents you target and removes any earlier Intent edit-gate hooks.

| Agent | Hook config |
| --- | --- |
| Claude Code | `~/.claude/settings.json` |
| Codex | `~/.codex/hooks.json` |
| GitHub Copilot CLI | `~/.copilot/hooks/hooks.json` (or `$COPILOT_HOME/hooks/hooks.json`) |

Codex may hold new hooks for review; open its hook browser and trust the Intent hook if prompted.

## Related

- [`intent install`](./intent-install) - set up hook delivery.
- [`intent list`](./intent-list) - see which skills are available.
- [`intent load`](./intent-load) - print a skill's guidance.
