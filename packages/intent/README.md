# @tanstack/intent

A CLI for library maintainers to generate, validate, and ship [Agent Skills](https://agentskills.io) alongside their npm packages.

## The problem

Your docs are good. Your types are solid. Your agent still gets it wrong.

Docs target humans who browse. Types check individual API calls but can't encode intent. Training data snapshots the ecosystem as it _was_, mixing versions with no way to tell which applies. Once a breaking change ships, models develop a permanent split-brain — training data contains _both_ versions forever with no way to disambiguate.

The ecosystem already moves toward agent-readable knowledge — Cursor rules, CLAUDE.md files, skills directories. But delivery is stuck in copy-paste: hunt for a community-maintained rules file, paste it into your config, repeat for every tool. No versioning, no update path, no staleness signal.

## Skills: versioned knowledge in your package manager

A skill is a short, versioned document that tells agents how to use a specific capability of your library — correct patterns, common mistakes, and when to apply them. Skills ship inside your package and travel with the tool via your normal package manager update flow — not the model's training cutoff, not community-maintained rules files, not prompt snippets in READMEs. Versioned knowledge the maintainer owns, updated when the package updates.

Each skill declares its source docs. When those docs change, the CLI flags the skill for review. One source of truth, one derived artifact that stays in sync.

The [Agent Skills spec](https://agentskills.io) is an open standard already adopted by VS Code, GitHub Copilot, OpenAI Codex, Cursor, Claude Code, Goose, Amp, and others.

## Quick Start

### Command runners

Use whichever command runner matches your environment:

| Tool | Pattern                                      |
| ---- |----------------------------------------------|
| npm  | `npx @tanstack/intent@latest <command>`      |
| pnpm | `pnpm dlx @tanstack/intent@latest <command>` |
| bun  | `bunx @tanstack/intent@latest <command>`     |

If you use Deno, support is best-effort today via `npm:` interop with `node_modules` enabled. First-class Deno runtime support is not implemented yet.

### For library consumers

Set up skill-to-task mappings in your project's agent config files (CLAUDE.md, .cursorrules, etc.):

```bash
npx @tanstack/intent@latest install
```

No per-library setup. No hunting for rules files. Install the package, run `npx @tanstack/intent@latest install` through your preferred command runner, and the agent understands the tool. Update the package, and skills update too.

List available skills from installed packages:

```bash
npx @tanstack/intent@latest list
```

### For library maintainers

Generate skills for your library by telling your AI coding agent to run:

```bash
npx @tanstack/intent@latest scaffold
```

This walks the agent through domain discovery, skill tree generation, and skill creation — one step at a time with your review at each stage.

Validate your skill files:

```bash
npx @tanstack/intent@latest validate
```

In a monorepo, you can validate a package from the repo root:

```bash
npx @tanstack/intent@latest validate packages/router/skills
```

Check for skills that have fallen behind their sources:

```bash
npx @tanstack/intent@latest stale
```

From a monorepo root, `intent stale` checks every workspace package that ships skills. To scope it to one package, pass a directory like `intent stale packages/router`.

Copy CI workflow templates into your repo so validation and staleness checks run on every push:

```bash
npx @tanstack/intent@latest setup-github-actions
```

## Compatibility

| Environment    | Status      | Notes                                              |
| -------------- | ----------- | -------------------------------------------------- |
| Node.js + npm  | Supported   | Use `npx @tanstack/intent@latest <command>`   |
| Node.js + pnpm | Supported   | Use `pnpm dlx @tanstack/intent@latest <command>`   |
| Node.js + Bun  | Supported   | Use `bunx @tanstack/intent@latest <command>`       |
| Deno           | Best-effort | Requires `npm:` interop and `node_modules` support |
| Yarn PnP       | Unsupported | `@tanstack/intent` scans `node_modules`            |

## Monorepos

- Run `intent setup-github-actions` from either the repo root or a package directory. Intent detects the workspace root and writes workflows to the repo-level `.github/workflows/` directory.
- Generated workflows are monorepo-aware: validation loops over workspace packages with skills, staleness checks run from the workspace root, and notify workflows watch package `src/` and docs paths.
- Run `intent validate packages/<pkg>/skills` from the repo root to validate one package without root-level packaging warnings.
- Run `intent stale` from the repo root to check all workspace packages with skills, or `intent stale packages/<pkg>` to check one package.

## Keeping skills current

The real risk with any derived artifact is staleness. `intent stale` flags skills whose source docs have changed, and CI templates catch drift before it ships.

The feedback loop runs both directions. `intent feedback` lets users submit structured reports when a skill produces wrong output — which skill, which version, what broke. That context flows back to the maintainer, and the fix ships to everyone on the next package update. Every support interaction produces an artifact that prevents the same class of problem for all future users — not just the one who reported it.

## CLI Commands

| Command                       | Description                                         |
| ----------------------------- | --------------------------------------------------- |
| `intent install`              | Set up skill-to-task mappings in agent config files |
| `intent list [--json]`        | Discover intent-enabled packages                    |
| `intent meta`                 | List meta-skills for library maintainers            |
| `intent scaffold`             | Print the guided skill generation prompt            |
| `intent validate [dir]`       | Validate SKILL.md files                             |
| `intent setup-github-actions` | Copy CI templates into your repo                    |
| `intent stale [dir] [--json]` | Check skills for version drift                      |
| `intent feedback`             | Submit skill feedback                               |

## License

[MIT](./LICENSE)
