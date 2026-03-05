# @tanstack/intent

Ship compositional knowledge for AI coding agents alongside your npm packages.

## The problem

Your docs are good. Your types are solid. Your agent still gets it wrong.

Docs target humans who browse. Types check individual API calls but can't encode intent. Training data snapshots the ecosystem as it _was_, mixing versions without flagging which applies. Once a breaking change ships, models contain _both_ versions forever with no way to disambiguate.

The ecosystem already moves toward agent-readable knowledge — Cursor rules, CLAUDE.md files, skills directories. But delivery is stuck in copy-paste: hunt for a community-maintained rules file, paste it into your config, repeat for every tool. No versioning, no update path, no staleness signal.

## Skills: the fourth artifact

You ship code, docs, and types. Skills are the fourth artifact — knowledge encoded for the thing writing most of your code.

Skills are npm packages of knowledge — encoding how tools compose, which patterns fit which goals, and what to avoid. When a library ships skills using `@tanstack/intent`, that knowledge travels with the tool via `npm update` — not the model's training cutoff. Versioned knowledge the maintainer owns, updated when the package updates.

Each skill declares its source docs. When those docs change, the CLI flags the skill for review. One source of truth, one derived artifact that stays in sync.

## Quick Start

### For library consumers

Set up skill-to-task mappings in your project's agent config files (CLAUDE.md, .cursorrules, etc.):

```bash
npx @tanstack/intent install
```

No per-library setup. No hunting for rules files. Install the package, run `intent install`, and the agent understands the tool. Update the package, and skills update too.

List available skills from installed packages:

```bash
npx @tanstack/intent list
```

### For library maintainers

Generate skills for your library by telling your AI coding agent to run:

```bash
npx @tanstack/intent scaffold
```

This prints a prompt that walks the agent through domain discovery, skill tree generation, and skill creation — one step at a time with your review at each stage.

Validate your skill files:

```bash
npx @tanstack/intent validate
```

Check for skills that have fallen behind their sources:

```bash
npx @tanstack/intent stale
```

Copy CI workflow templates into your repo so validation and staleness checks run on every push:

```bash
npx @tanstack/intent setup
```

## Keeping skills current

The real risk with any derived artifact is staleness. `npx @tanstack/intent stale` flags skills whose source docs have changed, and CI templates catch drift before it ships.

The feedback loop runs both directions. `npx @tanstack/intent feedback` lets users submit structured reports when a skill produces wrong output — which skill, which version, what broke. That context flows back to the maintainer, and the fix ships to everyone on the next `npm update`.

## CLI Commands

| Command                                      | Description                                         |
| -------------------------------------------- | --------------------------------------------------- |
| `npx @tanstack/intent install`               | Set up skill-to-task mappings in agent config files |
| `npx @tanstack/intent list [--json]`         | Discover intent-enabled packages                    |
| `npx @tanstack/intent meta`                  | List meta-skills for library maintainers            |
| `npx @tanstack/intent scaffold`              | Print the guided skill generation prompt            |
| `npx @tanstack/intent validate [dir]`        | Validate SKILL.md files                             |
| `npx @tanstack/intent setup`                 | Copy CI templates, generate shim, create labels     |
| `npx @tanstack/intent stale [--json]`        | Check skills for version drift                      |
| `npx @tanstack/intent feedback`              | Submit skill feedback                               |

## License

[MIT](./LICENSE)
