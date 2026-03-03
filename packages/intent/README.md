# @tanstack/intent

Ship compositional knowledge for AI coding agents alongside your npm packages.

Skills are npm packages of knowledge — encoding how tools work together, what patterns apply for which goals, and what to avoid. Skills travel with the tool via `npm update`, not the model's training cutoff.

`@tanstack/intent` is the toolkit for generating, discovering, and maintaining skills for your library.

## Install

```bash
pnpm add -D @tanstack/intent
```

## Quick Start

### For library consumers

Set up intent discovery in your project's agent config files (CLAUDE.md, .cursorrules, etc.):

```bash
npx intent init
```

List available skills from installed packages:

```bash
npx intent list
```

### For library maintainers

Generate skills for your library using the guided scaffold workflow:

```bash
npx intent scaffold
```

Validate your skill files:

```bash
npx intent validate
```

Copy CI and Oz workflow templates into your repo:

```bash
npx intent setup
```

## CLI Commands

| Command                  | Description                                      |
| ------------------------ | ------------------------------------------------ |
| `intent init`            | Inject intent discovery into agent config files  |
| `intent list [--json]`   | Discover intent-enabled packages                 |
| `intent meta`            | List meta-skills for library maintainers         |
| `intent scaffold`        | Print the guided skill generation prompt         |
| `intent validate [dir]`  | Validate SKILL.md files                          |
| `intent setup`           | Copy CI/Oz workflow templates                    |
| `intent stale [--json]`  | Check skills for version drift                   |
| `intent feedback`        | Submit skill feedback                            |

## License

[MIT](./LICENSE)
