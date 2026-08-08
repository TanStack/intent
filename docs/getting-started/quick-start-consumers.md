---
title: Quick Start for Consumers
id: quick-start-consumers
---

## 1. Run install

```bash
npx @tanstack/intent@latest install
```

This command creates or updates skill-loading guidance for your agent.

Examples use `npx` for npm projects. In pnpm, Yarn, or Bun projects, use the matching runner: `pnpm dlx`, `yarn dlx`, or `bunx`.

The command:

1. Checks for existing `intent-skills` guidance in your config files (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`, etc.)
2. Writes lightweight instructions for skill discovery and loading
3. Preserves content outside the managed block
4. Verifies the managed block before reporting success

If an `intent-skills` block already exists, Intent updates that file in place.
If no block exists, `AGENTS.md` is the default target.

Intent creates guidance like:

```markdown
<!-- intent-skills:start -->
## Skill Loading

Before editing files for a substantial task:
- Run `pnpm dlx @tanstack/intent@latest list` from the workspace root to see available local skills.
- If a listed skill matches the task, run `pnpm dlx @tanstack/intent@latest load <package>#<skill>` before changing files.
- Use the loaded `SKILL.md` guidance while making the change.
- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.
- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.
<!-- intent-skills:end -->
```

Intent detects the package manager when generating this block, so the runner may be `npx`, `pnpm dlx`, `yarn dlx`, or `bunx`.

To enforce loading guidance before edits in supported agents, opt in to hooks:

```bash
npx @tanstack/intent@latest hooks install
```

Project-scoped hooks are installed for Claude Code and Codex. `intent install` can write project guidance to `.github/copilot-instructions.md`, but GitHub Copilot CLI hook enforcement is user-scoped, so configure it explicitly:

```bash
npx @tanstack/intent@latest hooks install --scope user --agents copilot
```

Cursor and generic `AGENTS.md` agents use the guidance block only.

Hooks return the available Intent skill catalog as context for supported agent sessions and keep the edit gate active until they observe a supported `intent load` command.

Hooks do not verify that:

- The command succeeded.
- The skill matched the task.
- The agent applied the guidance.

To control what appears in the session catalog, configure `intent.skills` and `intent.exclude` in `package.json`.

## 2. Choose which packages' skills to use

`package.json#intent.skills` is an allowlist of the packages whose skills you want surfaced.

```json
{
  "intent": {
    "skills": ["@tanstack/*"]
  }
}
```

List the packages or `*` package patterns you trust. Intent then surfaces skills from matching packages and leaves the rest out. See the [source entries](../concepts/configuration#source-entries) in Configuration for the forms an entry can take, and [Trust model](../concepts/trust-model) for why the allowlist exists.

## 3. Use skills in your workflow

Load a skill when it matches the task:

```bash
npx @tanstack/intent@latest load @tanstack/react-query#core
```

This prints the skill content for the installed package version.

Intent cannot guarantee that an agent selected the correct skill or followed its guidance. See [Lifecycle boundaries](../concepts/trust-model#lifecycle-boundaries).

If you want explicit task-to-skill mappings in your agent config, opt in:

```bash
npx @tanstack/intent@latest install --map
```

## 4. Keep skills up-to-date

```bash
npm update @tanstack/react-query
```

Skills version with library releases. Updating a library also updates its packaged skills, so the skill version matches the installed code. If a package is installed both locally and globally and global scanning is enabled, Intent prefers the local version.

List the installed skills:

```bash
npx @tanstack/intent@latest list
```

Use `--json` for machine-readable output:

```bash
npx @tanstack/intent@latest list --json
```

Global package scanning is opt-in:

```bash
npx @tanstack/intent@latest list --global
```

You can also check if any skills reference outdated source documentation:

```bash
npx @tanstack/intent@latest stale
```
