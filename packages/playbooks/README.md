# @tanstack/playbooks

Toolkit for generating, discovering, and maintaining AI coding agent skills for libraries.

Playbooks let library maintainers ship SKILL.md files alongside their packages — structured instructions that AI coding agents can discover and follow when working with the library.

## Install

```bash
pnpm add -D @tanstack/playbooks
```

## Quick Start

### For library consumers

Set up playbook discovery in your project's agent config files (CLAUDE.md, .cursorrules, etc.):

```bash
npx playbook init
```

List available skills from installed packages:

```bash
npx playbook list
```

### For library maintainers

Generate skills for your library using the guided scaffold workflow:

```bash
npx playbook scaffold
```

Validate your skill files:

```bash
npx playbook validate
```

Copy CI and Oz workflow templates into your repo:

```bash
npx playbook setup
```

## CLI Commands

| Command | Description |
|---------|-------------|
| `playbook init` | Inject playbook discovery into agent config files |
| `playbook list [--json]` | Discover playbook-enabled packages |
| `playbook meta` | List meta-skills for library maintainers |
| `playbook scaffold` | Print the guided skill generation prompt |
| `playbook validate [dir]` | Validate SKILL.md files |
| `playbook setup` | Copy CI/Oz workflow templates |
| `playbook stale [--json]` | Check skills for version drift |
| `playbook feedback` | Submit skill feedback |

## License

[MIT](./LICENSE)
