---
title: Quick Start for Consumers
id: quick-start-consumers
---

## 1. Run install

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: @tanstack/intent@latest install
solid: @tanstack/intent@latest install
vue: @tanstack/intent@latest install
svelte: @tanstack/intent@latest install
angular: @tanstack/intent@latest install
lit: @tanstack/intent@latest install

<!-- ::end:tabs -->

Run this in an interactive terminal. On first use, Intent helps you choose which installed packages and skills your agent may use, then creates or updates skill-loading guidance.

1. **Choose what to enable.** Pick **Enable all**, **Choose packages or scopes**, or **Choose individual skills**. Package and skill lists support search.
2. **Confirm and finish.** Check the saved rules and destination `package.json`. Choose **Continue with all selected skills** to save, or **Review individual skills** to pick which selected packages to inspect before confirming. Intent writes permissions and guidance, verifies the guidance, and shows a command to list available skills.

**Enable all** saves `"*"`. A package choice saves `"@tanstack/ai"`; a whole scope saves `"@tanstack/*"`. These rules include future matching skills. Individual choices use `"@tanstack/ai#skill"`. Unchecking a skill during review adds an exclusion while keeping its broad rule.

Skill instructions can change when dependencies update. Update notifications are not available yet. See **About skill access and updates** in the installer for details.

Selecting nothing requires explicit confirmation to disable all skills. If no skills are found, or all are excluded, Intent explains the next step and leaves permissions and guidance unchanged. Install a package that ships skills or review your exclusions, then run `install` again.

Canceling before confirmation writes neither file. `--dry-run` previews the flow without writing. First-run setup requires a terminal; noninteractive execution fails without writes when permissions have not been configured.

If an `intent-skills` block already exists, Intent updates that file in place.
If no block exists, `AGENTS.md` is the default target.

The managed block instructs agents to run `intent list` from the workspace root, load the most specific matching skill with `intent load`, and apply its guidance before editing. Intent generates those commands using the detected package manager's runner. See [Default output](../cli/intent-install#default-output) for the installed instructions and [Mapping output](../cli/intent-install#mapping-output) for explicit task mappings.

To enforce loading guidance before edits in supported agents, opt in to hooks:

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: @tanstack/intent@latest hooks install
solid: @tanstack/intent@latest hooks install
vue: @tanstack/intent@latest hooks install
svelte: @tanstack/intent@latest hooks install
angular: @tanstack/intent@latest hooks install
lit: @tanstack/intent@latest hooks install

<!-- ::end:tabs -->

Project-scoped hooks are installed for Claude Code and Codex. `intent install` can write project guidance to `.github/copilot-instructions.md`, but GitHub Copilot CLI hook enforcement is user-scoped, so configure it explicitly:

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: @tanstack/intent@latest hooks install --scope user --agents copilot
solid: @tanstack/intent@latest hooks install --scope user --agents copilot
vue: @tanstack/intent@latest hooks install --scope user --agents copilot
svelte: @tanstack/intent@latest hooks install --scope user --agents copilot
angular: @tanstack/intent@latest hooks install --scope user --agents copilot
lit: @tanstack/intent@latest hooks install --scope user --agents copilot

<!-- ::end:tabs -->

Cursor and generic `AGENTS.md` agents use the guidance block only.

Hooks return the available Intent skill catalog as context for supported agent sessions and keep the edit gate active until they observe a supported `intent load` command.

Hooks do not verify that:

- The command succeeded.
- The skill matched the task.
- The agent applied the guidance.

To control what appears in the session catalog, configure `intent.skills` and `intent.exclude` in `package.json`.

## 2. Review the saved permissions

`install` saves your choices in `package.json#intent.skills`, an allowlist of packages or individual skills. It uses the nearest `package.json` that owns the directory where you ran the command.

```json
{
  "intent": {
    "skills": ["@tanstack/react-query#core"]
  }
}
```

When permissions already exist, including inherited workspace permissions, `install` preserves them and only updates guidance. To change your choices, edit the owning `intent.skills` declaration. You can also use `*` package patterns such as `@tanstack/*`. Existing `intent.exclude` rules still take precedence. See the [source entries](../concepts/configuration#source-entries) in Configuration and the [Trust model](../concepts/trust-model).

## 3. Use skills in your workflow

Load a skill when it matches the task:

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: @tanstack/intent@latest load @tanstack/react-query#core
solid: @tanstack/intent@latest load @tanstack/react-query#core
vue: @tanstack/intent@latest load @tanstack/react-query#core
svelte: @tanstack/intent@latest load @tanstack/react-query#core
angular: @tanstack/intent@latest load @tanstack/react-query#core
lit: @tanstack/intent@latest load @tanstack/react-query#core

<!-- ::end:tabs -->

This prints the skill content for the installed package version.

Intent cannot guarantee that an agent selected the correct skill or followed its guidance. See [Lifecycle boundaries](../concepts/trust-model#lifecycle-boundaries).

If you want explicit task-to-skill mappings in your agent config, opt in:

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: @tanstack/intent@latest install --map
solid: @tanstack/intent@latest install --map
vue: @tanstack/intent@latest install --map
svelte: @tanstack/intent@latest install --map
angular: @tanstack/intent@latest install --map
lit: @tanstack/intent@latest install --map

<!-- ::end:tabs -->

## 4. Keep skills up-to-date

Update the library through your project's dependency-update workflow.

Skills version with library releases. Updating a library also updates its packaged skills, so the skill version matches the installed code. If a package is installed both locally and globally and global scanning is enabled, Intent prefers the local version.

List the installed skills:

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: @tanstack/intent@latest list
solid: @tanstack/intent@latest list
vue: @tanstack/intent@latest list
svelte: @tanstack/intent@latest list
angular: @tanstack/intent@latest list
lit: @tanstack/intent@latest list

<!-- ::end:tabs -->

Use `--json` for machine-readable output:

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: @tanstack/intent@latest list --json
solid: @tanstack/intent@latest list --json
vue: @tanstack/intent@latest list --json
svelte: @tanstack/intent@latest list --json
angular: @tanstack/intent@latest list --json
lit: @tanstack/intent@latest list --json

<!-- ::end:tabs -->

Global package scanning is opt-in:

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: @tanstack/intent@latest list --global
solid: @tanstack/intent@latest list --global
vue: @tanstack/intent@latest list --global
svelte: @tanstack/intent@latest list --global
angular: @tanstack/intent@latest list --global
lit: @tanstack/intent@latest list --global

<!-- ::end:tabs -->

You can also check if any skills reference outdated source documentation:

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: @tanstack/intent@latest stale
solid: @tanstack/intent@latest stale
vue: @tanstack/intent@latest stale
svelte: @tanstack/intent@latest stale
angular: @tanstack/intent@latest stale
lit: @tanstack/intent@latest stale

<!-- ::end:tabs -->
