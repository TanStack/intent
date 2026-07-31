---
title: intent install
id: intent-install
---

`intent install` sets up trusted skill delivery for your project. It records which packages you trust, locks the skill content you accept, and delivers those skills to your coding agents. Run it once to set up a project, and again after dependencies change to review and accept updates. For a step-by-step walkthrough, see the [consumer quick start](../getting-started/quick-start-consumers).

The default is an interactive setup where you choose how skills are delivered: symlinks, lifecycle hooks, or a static guidance block. `--map` writes the static guidance block directly, without the interactive prompts and without a terminal.

<!-- ::start:tabs variant="package-manager" mode="local-install" -->
@tanstack/intent@latest install [--map] [--dry-run] [--global] [--global-only] [--no-notices]
<!-- ::end:tabs -->

## Options

- `--map`: write the static guidance block directly, without the interactive setup.
- `--dry-run`: report what install would write, and change nothing.
- `--global`: with `--map`, include global packages after the project packages.
- `--global-only`: with `--map`, use only global packages.
- `--no-notices`: suppress non-critical notices on stderr.

## Interactive setup

The default `install` runs an interactive setup, so it needs a terminal. For CI or a non-interactive shell, use `--map`.

Intent asks how to deliver skills, where to deliver them, and which skills to trust, then confirms before writing. There are three delivery choices:

- **Symlinks** link the accepted skill folders into your agent directories.
- **Lifecycle hooks** surface accepted skills at the start of an agent session.
- **Static guidance block** writes an `intent-skills` block into a file such as `AGENTS.md`.

Every choice records your trusted sources in `package.json` (`intent.skills`, plus any `intent.exclude`) and the content you accepted in `intent.lock`.

Symlinks and hooks are managed delivery: Intent also writes `.intent/delivery.json` and keeps the skills in place. With symlinks it runs [`intent sync`](./intent-sync) once, adds the links to `.git/info/exclude`, and adds a `prepare: intent sync` script when Intent is a dev dependency, then prints a line such as `Installed 5 skills using symlink.` The static guidance block is a snapshot rather than managed delivery, the same output as the `--map` snapshot below; Intent prints a line such as `Installed 5 skills to AGENTS.md as a static guidance block.`

Use `--dry-run` to preview any of this without writing files. See the [trust model](../concepts/trust-model) for how trusted sources and accepted content combine.

## Portable snapshot with --map

`install --map` writes the static guidance block without the interactive setup, and unlike the default it does not need a terminal, so it suits CI. The resulting block lists each skill with the command your agent runs to load it. It is a snapshot: it does not update when dependencies change, so re-run the command to refresh it.

Supported files are `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, and `.github/copilot-instructions.md`. In a terminal, Intent asks which file to use or lets you name another project file. It includes only packages permitted by `intent.skills` and skips reference, meta, and maintainer skills. `--global` and `--global-only` add global packages. On a project with no policy yet, a terminal run also helps you pick which skills to trust and writes `intent.skills` and `intent.lock`.

The block stores portable identities and commands, never local file paths:

```yaml
<!-- intent-skills:start -->
# TanStack Intent - before editing files, run the matching guidance command.
tanstackIntent:
  - id: "@tanstack/query#fetching"
    run: "npx @tanstack/intent@latest load @tanstack/query#fetching"
    for: "Query data fetching patterns"
<!-- intent-skills:end -->
```

- `id`: portable skill identity in `<package>#<skill>` form.
- `run`: the package-manager-aware command to load the skill.
- `for`: a task-routing phrase for the agent.

Intent verifies the block after writing and reports the result, such as `Created AGENTS.md with 1 mapping.` or `No changes to AGENTS.md; 2 mappings already current.` If it finds no usable skills it prints `No intent-enabled skills found.` and writes nothing.

## When install stops

- **No terminal.** The interactive setup needs a TTY. Without one, install stops and points you to `--map`.
- **Symlinks not possible.** Archive-backed and Yarn Plug'n'Play sources cannot be symlinked. Install stops and tells you to choose hook delivery or the static guidance block instead.
- **Target conflict.** If a delivery target already contains a conflicting file, install stops and lists the paths so you can move them.

## Related

- [Consumer quick start](../getting-started/quick-start-consumers)
- [Trust model](../concepts/trust-model)
- [`intent list`](./intent-list)
- [`intent hooks`](./intent-hooks)
