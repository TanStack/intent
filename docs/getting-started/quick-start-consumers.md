---
title: Quick Start for Consumers
id: quick-start-consumers
---

Get started using Intent to help your agent discover and load package skills.

## 1. Install lifecycle hooks

For Claude Code, Codex, and GitHub Copilot, install project lifecycle hooks:

```bash
npx @tanstack/intent@latest hooks install
```

Examples use `npx` for npm projects. In pnpm, Yarn, or Bun projects, use the matching runner: `pnpm dlx`, `yarn dlx`, or `bunx`.

The hooks:

1. Discover allowed workspace skills when an agent session starts.
2. Inject a compact catalogue of skill IDs and descriptions into session context.
3. Reuse a cached catalogue on resume, clear, compact, and subagent callbacks where supported.
4. Tell the agent to load full guidance only when a skill clearly matches the task.

Hooks are advisory. They do not block edits or claim to prove that a loaded skill semantically matches the current task. If no skill matches, the agent continues normally.

For Cursor and generic `AGENTS.md` agents, install minimal fallback guidance instead:

```bash
npx @tanstack/intent@latest install --mode fallback
```

This updates an existing managed block or creates `AGENTS.md` without embedding the discovered catalogue:

```markdown
<!-- intent-skills:start -->
## TanStack Intent skills

Use the Intent skill catalogue already supplied to the current agent session.

- Do not run `intent list` for every task.
- Before substantial work, check the current session catalogue for a clear task match.
- If a skill clearly matches, run `pnpm dlx @tanstack/intent@latest load <package>#<skill>` before editing relevant files.
- If no skill clearly matches, continue normally.
- If no catalogue is available in the current session, run `pnpm dlx @tanstack/intent@latest list` once from the workspace root.
- Re-run discovery only when dependencies or Intent configuration have changed, or when the existing catalogue is unavailable.
<!-- intent-skills:end -->
```

`intent install --mode hooks` is equivalent to `intent hooks install`. Use `--scope user` for personal cross-project hooks. To tailor the catalogue, configure `intent.skills` and `intent.exclude` in `package.json`.

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

When your agent works on a task that matches an available skill, it loads the matching `SKILL.md` into context.

Load a skill manually:

```bash
npx @tanstack/intent@latest load @tanstack/react-query#core
```

This prints the skill content for the installed package version.

If you want explicit task-to-skill mappings in your agent config, opt in:

```bash
npx @tanstack/intent@latest install --mode map
```

`--map` remains an alias for compatibility. Static mappings become always-on context, so prefer lifecycle hooks when the agent supports them.

## 4. Keep skills up-to-date

Skills version with library releases. When you update a library:

```bash
npm update @tanstack/react-query
```

The new version brings updated skills automatically. The skills are shipped with the library, so you get the version that matches your installed code. If a package is installed both locally and globally and global scanning is enabled, Intent prefers the local version.

If you need to see what skills have changed, run:

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
