# @tanstack/playbooks

Ship compositional knowledge for AI coding agents alongside your npm packages.

Playbooks are npm packages of skills — encoding how tools work together, what patterns apply for which goals, and what to avoid. Skills travel with the tool via `npm update`, not the model's training cutoff.

`@tanstack/playbooks` is the toolkit for generating, discovering, and maintaining skills for your library.

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
