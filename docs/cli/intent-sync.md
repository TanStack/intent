---
title: intent sync
id: intent-sync
---

`intent sync` updates the managed symlinks for symlink delivery so your agent sees the skills you have accepted. Run it after installing dependencies or pulling changes. With symlink delivery, `install` also adds a `prepare` script so `sync` runs after each `npm install`.

<!-- ::start:tabs variant="package-manager" mode="local-install" -->
@tanstack/intent@latest sync [--dry-run] [--json]
<!-- ::end:tabs -->

## Options

- `--dry-run`: report what sync would change without touching any links, then print `No files changed.`
- `--json`: print compact structured link and review results.

## Prerequisites

`sync` works only with symlink delivery, and it needs the state that `intent install` writes:

- `.intent/delivery.json` set to symlink delivery. Without it, sync exits with an error and tells you to run `intent install` interactively.
- `package.json` policy and `intent.lock`. Without them, sync exits with an error and tells you to run `intent install` interactively.

For hook delivery, run `intent install` instead; `sync` does not manage hooks.

## What it does

`sync` reconciles the symlinks in your agent directories against `intent.lock`: it adds links for accepted skills and removes links that no longer belong. It reports anything that needs your attention rather than accepting it silently:

- **New dependencies** that ship skills you have not trusted.
- **New skills** in a package you already trust.
- **Changed skill content** that no longer matches `intent.lock`.

New and changed skills are held for review. In a human terminal, sync offers to enable or exclude new dependencies and names packages that need review. Explicit agent runs and the generated `prepare` script never prompt or reveal untrusted package names; they report counts and tell the agent to pause and ask the user to run interactive install. To accept changed content as a new baseline, run `intent install`.

When no work is needed, a human run prints one summary line. Agent and `prepare` runs stay silent. Human link changes include project-relative paths; agent and `prepare` output reports counts only.

## JSON output

```json
{
	"dryRun": true,
	"links": {
		"created": [],
		"repaired": [],
		"removed": [],
		"conflicts": [],
		"unchangedCount": 41
	},
	"review": {
		"newDependencies": [],
		"newSkills": [],
		"changed": []
	}
}
```

Each review entry contains `name` and `skillCount`. Explicit agent JSON blanks names for untrusted new dependencies.

## When sync stops

- **No delivery configured.** sync exits with an error and points to interactive install.
- **Missing policy or lockfile.** sync stops and points you to `intent install`.
- **Hook delivery.** sync manages symlinks only; use `intent install` to repair hooks.
- **Symlinks not possible.** Archive-backed and Yarn Plug'n'Play sources cannot be symlinked; sync stops and tells you to use hook delivery.
- **Link conflict.** If a managed target already holds an unmanaged file, sync stops and lists the paths.
- **Malformed install state.** sync stops and explains how to restore or reset the Intent-managed links and state.

## Related

- [`intent install`](./intent-install) - configure delivery and accept a new baseline.
- [Trust model](../concepts/trust-model) - how the lockfile gates content.
