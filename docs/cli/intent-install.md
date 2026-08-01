---
title: intent install
id: intent-install
---

`intent install` sets up trusted skill delivery for your project. It records which packages you trust, locks the skill content you accept, and delivers those skills to your coding agents. Run it once to set up a project, and again after dependencies change to review and accept updates. For a step-by-step walkthrough, see the [consumer quick start](../getting-started/quick-start-consumers).

The default is an interactive setup where you choose how skills are delivered: symlinks, lifecycle hooks, or a static guidance block. `--map` writes the static guidance block directly, without the interactive delivery prompts and without a terminal.

<!-- ::start:tabs variant="package-manager" mode="local-install" -->
@tanstack/intent@latest install [--map] [--dry-run] [--debug] [--no-notices]
<!-- ::end:tabs -->

## Options

- `--map`: write catalog loading guidance directly, without managed delivery.
- `--dry-run`: report what install would write, and change nothing.
- `--debug`: include package paths in diagnostic output.
- `--no-notices`: suppress non-critical notices on stderr.

## Interactive setup

The default `install` runs an interactive setup, so it needs a terminal. For CI or a non-interactive shell, use `--map`.

Intent asks how to deliver skills, where to deliver them, and which skills to trust, then confirms before writing. There are three delivery choices:

- **Symlinks** link the accepted skill folders into your agent directories.
- **Lifecycle hooks** surface accepted skills at the start of an agent session.
- **Static guidance block** writes an `intent-skills` block into a file such as `AGENTS.md`.

Every choice records your trusted sources in `package.json` as explicit `intent.skills` and `intent.exclude` arrays, and the content you accepted in `intent.lock`.

Symlinks and hooks are managed delivery: Intent also writes `.intent/delivery.json`, adds `.intent/` to the project `.gitignore`, and keeps the skills in place. With symlinks it runs [`intent sync`](./intent-sync) once, adds generated link paths to the checkout's `.git/info/exclude`, and adds a `prepare: intent sync` script when Intent is a dev dependency, then prints a line such as `Installed 5 skills using symlink.` Static guidance is committed agent instructions without managed delivery; Intent prints a line such as `Installed 5 skills to AGENTS.md as a static guidance block.`

Use `--dry-run` to preview any of this without writing files. See the [trust model](../concepts/trust-model) for how trusted sources and accepted content combine.

## Portable guidance with --map

`install --map` writes a compact static block without managed delivery. The block tells an agent to run `intent catalog` once when the session does not already contain an Intent catalog, then run `intent load <id>` only when a catalog entry matches the task. It does not embed every skill or description in the agent file.

Supported files are `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, and `.github/copilot-instructions.md`. In a terminal, Intent asks which file to use or lets you name another project file. On a project with no policy yet, a terminal run also helps you pick which skills to trust and writes `intent.skills`, `intent.exclude`, and `intent.lock`. An agent may regenerate guidance only when committed trust and lock state already exist; otherwise it stops and asks the user to run `intent install` interactively.

The block stores portable identities and commands, never local file paths:

```yaml
<!-- intent-skills:start -->
## Intent Skills

If an Intent catalog is not already present in this session context, run `npx @tanstack/intent@latest catalog` once.
If the catalog omits relevant skills, run `npx @tanstack/intent@latest catalog <package>` for the relevant package.
If a catalog entry matches the task, run `npx @tanstack/intent@latest load <package>#<skill>` before editing.
Do not rerun the catalog for every task. If no skill matches, continue normally.
<!-- intent-skills:end -->
```

When `@tanstack/intent` is a project dev dependency, generated guidance and hooks use `npx @tanstack/intent`, which resolves the installed package without relying on the ambiguous `intent` binary name. Otherwise they use a pinned one-off runner such as `npx @tanstack/intent@0.4`.

Intent verifies the block after writing and reports whether it created, updated, or left the target unchanged. If it finds no usable skills it prints `No intent-enabled skills found.` and writes nothing. `--dry-run` prints the target and proposed trust/delivery changes without writing the block, trust config, lockfile, or local delivery state. Warnings remain visible during review; use `--debug` when package paths are needed.

## When install stops

- **No terminal.** The interactive setup needs a TTY. Without one, install stops and points you to `--map`.
- **Symlinks not possible.** Archive-backed and Yarn Plug'n'Play sources cannot be symlinked. Install stops and tells you to choose hook delivery or the static guidance block instead.
- **Target conflict.** If a delivery target already contains a conflicting file, install stops and lists the paths so you can move them.

## Related

- [Consumer quick start](../getting-started/quick-start-consumers)
- [Trust model](../concepts/trust-model)
- [`intent list`](./intent-list)
- [`intent hooks`](./intent-hooks)
