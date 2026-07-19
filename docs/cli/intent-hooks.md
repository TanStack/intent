---
title: intent hooks
id: intent-hooks
---

`intent hooks install` installs advisory lifecycle hooks that inject a compact Intent skill catalogue into supported agent sessions.

```bash
npx @tanstack/intent@latest hooks install [--scope project|user] [--agents copilot,claude,codex|all]
```

`intent install --mode hooks` is equivalent.

## Lifecycle

On `SessionStart`, Intent resolves the workspace root, computes a dependency and configuration fingerprint, and reads a cached catalogue when the fingerprint is unchanged. A miss runs the same agent-audience discovery and source policy as `intent list`, stores a bounded summary in the operating-system temporary directory, and injects it as additional context.

Claude Code and Codex call `SessionStart` for `startup`, `resume`, `clear`, and `compact`, so the catalogue is re-injected after context loss without repeating discovery on a cache hit. GitHub Copilot documents `startup`, `resume`, and `new`; it does not document clear or post-compact catalogue injection.

All three installed adapters also use `SubagentStart`. The hook reads the same workspace cache, so subagents receive the compact catalogue without a separate full scan. GitHub notes that its built-in `general-purpose` agent does not emit subagent lifecycle events.

The catalogue contains only actionable skill IDs, normalized one-line descriptions, and safe warnings. It excludes package roots, lockfile paths, implementation paths, hidden sources, and full `SKILL.md` content. It is sorted and capped at 50 skills; truncated output says how many entries were omitted.

## Cache and refresh

Cache entries are keyed by the workspace root and the package policy scope that supplied the hook working directory. The fingerprint includes the schema version, workspace package manifests, workspace configuration, and root lockfiles for npm, pnpm, Yarn, Bun, and Deno. It does not hash source files or scan the whole repository merely to check staleness.

Dependency, workspace manifest, `intent.skills`, `intent.exclude`, or lockfile changes produce a new fingerprint and refresh discovery. Malformed cache files and read/write failures are treated as misses. Cache writes are atomic. Hook and discovery errors fail open and are written to stderr diagnostics, not injected context.

The `intent catalog --json` command reports cache status, duration, catalogue byte size, package count, skill count, and package manifest read count. It is the compact hook runner surface; `intent list` remains the human inventory command.

## Support matrix

| Agent | Project hook | User hook | Session reinjection | Subagent hook | Edit hook | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Claude Code | `.claude/settings.json` | `~/.claude/settings.json` | startup, resume, clear, compact | `SubagentStart` | No | Project settings can be restricted by managed policy; use `${CLAUDE_PROJECT_DIR}` for portable paths. |
| Codex | `.codex/hooks.json` | `~/.codex/hooks.json` | startup, resume, clear, compact | `SubagentStart` | No | Project hooks require project trust; each non-managed hook definition requires review. |
| GitHub Copilot CLI | `.github/hooks/intent.json` | `$COPILOT_HOME/hooks/hooks.json` or `~/.copilot/hooks/hooks.json` | startup, resume, new | `subagentStart` | No | Repository hooks also run in Copilot cloud agent when present on the default branch. |
| GitHub Copilot cloud agent | `.github/hooks/intent.json` on the default branch | N/A | one new session per job | `subagentStart` | No | Ephemeral Linux environment; no user hook files. |
| Cursor | Unsupported | Unsupported | Unsupported | Unsupported | No | Use fallback guidance or static mappings. |
| Generic `AGENTS.md` agent | Unsupported | Unsupported | Unsupported | Unsupported | No | Use fallback guidance or static mappings. |

Intent uses advisory loading because these hosts do not expose one reliable cross-agent task boundary that can prove a loaded skill matches each user task. A previous Intent gate treated any load observed during a session as permission for every later edit. Reinstalling hooks removes that Intent-owned `PreToolUse` entry while preserving unrelated hooks. Editing is not blocked when Intent fails or when no skill matches.

Hooks are workflow controls, not a security sandbox. Agent hosts may skip hooks, managed policy may disable them, and tool interception is not complete. Intent source allowlists and exclusions still determine which skills appear, but catalogue injection does not make package content trusted executable code.

## Runner selection

Generated runners first look for the workspace-local `@tanstack/intent` CLI. When it is unavailable, they use the package-manager-aware command recorded at installation. The fallback may use `dlx` or `npx`; install Intent in the workspace to avoid package downloads during lifecycle callbacks.

## Official references

- [GitHub Copilot hooks reference](https://docs.github.com/en/copilot/reference/hooks-reference)
- [GitHub Copilot CLI hooks](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/use-hooks)
- [GitHub Copilot cloud agent hooks](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/use-hooks)
- [Claude Code hooks reference](https://code.claude.com/docs/en/hooks)
- [Claude Code settings](https://code.claude.com/docs/en/settings)
- [Codex hooks](https://learn.chatgpt.com/docs/hooks)
- [Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)

## Related

- [intent install](./intent-install)
- [intent list](./intent-list)
- [intent load](./intent-load)