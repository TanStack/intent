---
title: intent install
id: intent-install
---

`intent install` configures lifecycle hooks, fallback guidance, or static task mappings.

```bash
npx @tanstack/intent@latest install --mode hooks|fallback|map
```

## Modes

### Hooks

```bash
npx @tanstack/intent@latest install --mode hooks [--scope project|user] [--agents copilot,claude,codex|all]
```

Equivalent to `intent hooks install`. This is the recommended mode for supported agents. It installs session and subagent lifecycle hooks and does not write an `intent-skills` repository guidance block.

### Fallback guidance

```bash
npx @tanstack/intent@latest install --mode fallback
```

Writes a compact managed block for agents without supported lifecycle hooks. For compatibility, plain `intent install` still selects fallback mode.

The fallback tells agents to use an existing session catalogue, load only a clear match, continue normally when no skill matches, and run `intent list` once only when no catalogue is available. It does not embed discovered skills.

### Static mappings

```bash
npx @tanstack/intent@latest install --mode map
```

Scans allowed skills and writes compact `id`, `run`, and `for` mappings into a supported instruction file. `intent install --map` remains an alias. Mappings are always-on context, so use them mainly when lifecycle hooks are unavailable.

## Options

- `--mode <mode>`: `hooks`, `fallback`, or `map`
- `--map`: compatibility alias for `--mode map`
- `--scope <scope>`: `project` or `user` for hook mode; defaults to `project`
- `--agents <agents>`: hook agents to install; defaults to `all`
- `--dry-run`: print fallback or mapping output without writing
- `--print-prompt`: print the legacy interactive mapping prompt
- `--global`: include global packages in map mode
- `--global-only`: use only global packages in map mode
- `--no-notices`: suppress non-critical scan notices

Fallback and map modes preserve content outside `<!-- intent-skills:start -->` and `<!-- intent-skills:end -->`. They update an existing managed block in `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, or `.github/copilot-instructions.md`; otherwise they create `AGENTS.md`.

## Migration

Running `intent install --mode fallback` updates an old managed block that says to run `intent list` before every substantial task. No separate migration command is required.

Repositories using supported agents should run `intent hooks install`. Hook installation is separate and does not remove an existing guidance block; run fallback installation when you intentionally want that block updated for unsupported agents too.

## Related

- [intent hooks](./intent-hooks)
- [intent list](./intent-list)
- [intent load](./intent-load)
- [Quick Start for Consumers](../getting-started/quick-start-consumers)