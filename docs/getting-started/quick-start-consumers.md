---
title: Quick Start for Consumers
id: quick-start-consumers
---

When a library you depend on ships Agent Skills, Intent puts that guidance in front of your coding agent. A skill tells your agent what to do, so you choose which dependencies to trust and how their skills reach your agent.

## Before you start

You need a project with a `package.json` and at least one installed dependency that ships skills. To check what dependencies in your project offer skills before you set anything up, Intent can scan your `node_modules` and report the candidates:

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

@tanstack/intent@latest list --show-hidden

<!-- ::end:tabs -->

Until you trust a package, its skills stay hidden, so `--show-hidden` is what reveals the candidates. Without it, a fresh project reports no packages even when a dependency ships skills.

## How to run Intent

Every command in this guide works with `npx @tanstack/intent@latest` and no install. That is fine for a quick start or a one-off, but `@latest` fetches whatever version is current, so a new release can change how a command behaves.

For the most stable experience, add Intent as a dev dependency:

<!-- ::start:tabs variant="package-manager" mode="dev-install" -->

@tanstack/intent

<!-- ::end:tabs -->

Your lockfile then records the exact version, so everyone on your team runs the same Intent and upgrades happen when you choose. With Intent installed and symlink delivery, `install` also adds a `prepare` script that runs `intent sync` after each `npm install`, so your managed links stay current without anyone remembering to run it.

## Install skills

`install` runs an interactive setup, so run it in a terminal. For committed agent loading instructions without managed delivery, use [portable guidance](#portable-guidance) instead.

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

@tanstack/intent@latest install

<!-- ::end:tabs -->

Intent asks:

- **How to deliver skills.** You can symlink the skill folders into your agent's directories, install lifecycle hooks that list available skills at the start of a session, or write static catalog loading guidance into an agent file such as `AGENTS.md`.
- **Where to put them.** Intent pre-selects the agent tools it can detect, such as GitHub Copilot, Cursor, Claude Code, Codex, VS Code, or a shared `.agents` directory. Symlinks support all of these; hooks at this time only support GitHub Copilot, Claude Code, and Codex (if you'd like to add hooks for other agents or platforms, we welcome contributions). You can also choose a custom folder for symlinks or hooks.
- **Which skills to trust.** Enable every skill it found, everything under a certain package name (eg. `@tanstack/*`), or pick individual skills. Only the packages you enable here can provide skills to your agent.
- **A final confirmation** before it writes anything.

> [!WARNING]
> Using symlinks can expose live package content before Intent can re-checks it. This means a skill can be updated in a dependency without Intent reviewing it first. If you want to review new or changed skills before they reach your agent, choose hook delivery instead.

Once finished, Intent prints a line describing how many skills were installed, e.g., `Installed 5 skills using symlink.`

## What install writes

Intent records your choices in three files:

- `package.json` holds explicit `intent.skills` and `intent.exclude` arrays for the sources you trust and the skills or packages you do not want.
- `intent.lock` holds contains the accepted skill contents, so teams can share the same baseline. It also records the package versions that shipped those skills, so Intent can detect when a dependency update changes its skills, or the contents of a skill you already accepted have changed.
- `.intent/delivery.json` holds your local delivery method and targets.

> [!NOTE]
> Intent adds `.intent/` to the project `.gitignore`. If you chose symlinks, it also adds the generated link paths to the checkout's `.git/info/exclude` so they do not get committed.

Commit `package.json` and `intent.lock` if you're looking for the project to share the same trusted sources and accepted skills. `.intent/` stays local to your checkout.

## Check that it worked

List the skills your project now trusts:

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

@tanstack/intent@latest list

<!-- ::end:tabs -->

Intent prints a summary such as `5 intent-enabled packages, 12 skills`, then the packages you trusted and their skills. Load one to read its guidance:

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

@tanstack/intent@latest load @tanstack/query#fetching

<!-- ::end:tabs -->

Replace `@tanstack/query#fetching` with a package and skill from your own list. `load` prints the `SKILL.md` shipped with the version installed in your project, and your agent can run the same command when it needs that guidance.

If a command does not behave as described, see [Troubleshooting](./troubleshooting).

## Keep skills current

Updating a dependency can add, remove, or change its skills. With symlink delivery, run [`intent sync`](../cli/intent-sync) to update the links; it flags new or changed skills for review before they reach your agent. Run `install` again when you are ready to accept a new baseline. See the [trust model](../concepts/trust-model) for how that review works.

## Portable guidance

`install --map` writes compact catalog loading instructions into an agent file such as `AGENTS.md` instead of setting up managed delivery:

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

@tanstack/intent@latest install --map

<!-- ::end:tabs -->

The instructions tell the agent to run `intent catalog` once if a catalog is not already present in session context, then load only a matching skill with `intent load <id>`. When Intent is a dev dependency, generated commands use the local binary; otherwise they use a pinned one-off runner. Hooks inject the same catalog automatically, while symlinks expose accepted skill folders directly.
