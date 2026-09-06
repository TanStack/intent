---
title: intent install
id: intent-install
---

`intent install` confirms skill-source permissions on first use, then creates or updates an `intent-skills` guidance block in a project guidance file.

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: @tanstack/intent@latest install [--maintainer] [--review] [--map] [--dry-run] [--print-prompt] [--global] [--global-only] [--no-notices]
solid: @tanstack/intent@latest install [--maintainer] [--review] [--map] [--dry-run] [--print-prompt] [--global] [--global-only] [--no-notices]
vue: @tanstack/intent@latest install [--maintainer] [--review] [--map] [--dry-run] [--print-prompt] [--global] [--global-only] [--no-notices]
svelte: @tanstack/intent@latest install [--maintainer] [--review] [--map] [--dry-run] [--print-prompt] [--global] [--global-only] [--no-notices]
angular: @tanstack/intent@latest install [--maintainer] [--review] [--map] [--dry-run] [--print-prompt] [--global] [--global-only] [--no-notices]
lit: @tanstack/intent@latest install [--maintainer] [--review] [--map] [--dry-run] [--print-prompt] [--global] [--global-only] [--no-notices]

<!-- ::end:tabs -->

## Options

### Permission review

- `--review`: review current skill permissions interactively, then update guidance

### Guidance output

- `--map`: write explicit task-to-skill mappings instead of lightweight loading guidance
- `--dry-run`: print the generated block without writing files
- `--print-prompt`: print the agent setup prompt instead of writing files

### Mapping scan scope

- `--global`: include global packages after project packages when `--map` is passed
- `--global-only`: install mappings from global packages only when `--map` is passed
- `--no-notices`: suppress non-critical notices on stderr

## Behavior

### Maintainer workflow

`install --maintainer` enables initial skill batches and source-aware skill maintenance in repository agent instructions. It works without an interactive terminal or existing consumer permissions. It writes a separate `intent-maintainer` block, preserves consumer guidance, and is idempotent. `--dry-run` previews the block.

Run it from the library root. The block loads the packaged authoring procedure for substantial library work; that procedure covers the cumulative domain map, spec, and skill tree, source review, task checks, and revision-bound outcomes. It updates the file that already contains either Intent managed block, or creates `AGENTS.md` when neither exists. It cannot be combined with `--review`, `--map`, `--print-prompt`, `--global`, or `--global-only`. See [Quick Start for Maintainers](../getting-started/quick-start-maintainers).

> [!NOTE] Maintainer installation writes guidance
> It does not add Intent to `package.json`, configure consumer skill permissions, install agent hooks, or add CI. The managed block uses the detected package manager's runner with `@tanstack/intent@latest`.

### Default install

If `intent.skills` is already configured, including through workspace inheritance, `install` only updates guidance. It does not prompt or change `package.json`. Run `intent install --review` to change permissions.

Otherwise, first-run setup requires an interactive terminal. Non-TTY execution fails before discovery or writes. Node.js 20.12.0 or newer is required.

#### First-run flow

1. **Choose what to enable.** Pick **Enable all**, **Choose packages or scopes**, or **Choose individual skills**. Package and skill lists support search.
2. **Confirm once.** Check the current skill count, saved rules, and destination file. Choose **Continue with all selected skills** to save, **Review individual skills** to inspect specific packages, or **Cancel**. Cancel is selected by default.
3. **Finish** with verified guidance, available skill and package counts, and a command to list those skills.

Descriptions, exclusions, and information about skill updates are optional choices on the setup screen.

#### What gets enabled

| Choice | Saved rule | Includes future additions? |
| --- | --- | --- |
| Enable all | `"*"` | All npm and workspace sources. |
| A package | `"@tanstack/ai"` | New skills in that package. |
| A whole scope | `"@tanstack/*"` | New npm packages and skills in that scope. |
| An individual skill | `"@tanstack/ai#skill"` | Only that skill name. |

Workspace choices use the `workspace:` prefix. Scope rules are saved only when explicitly selected; choosing several packages does not grant access to the whole scope.

**Review individual skills** lists only packages covered by your selection. Choose the packages you want to review, or leave the list empty to continue with all selected skills. Each chosen package opens its own skill list; other packages keep their selection. Unchecking a skill covered by a package, scope, or all-sources rule keeps the broad rule and adds that skill to `intent.exclude`. Existing exclusions always win and cannot be enabled through the picker.

Skill instructions can change when dependencies update. Enabling access does not freeze content or record approval of specific instructions. Update notifications are not available yet.

Selecting nothing requires explicit confirmation before writing `[]` to disable all skills. Unchecking every current skill under a broad rule excludes those skills; the rule still covers future additions.

#### Files and retry behavior

Permissions go in the nearest owning `package.json`. Inside a workspace package, this is that package's file. The update preserves formatting and uses an atomic replacement; if the file changes after preview, Intent stops and asks you to retry.

After permissions are saved, Intent updates an existing managed guidance block in a supported config file, or creates one in `AGENTS.md`. Content outside the block is preserved, and the block is verified before success is reported.

- **No skills found, or all excluded:** explains how to retry and writes nothing. Empty discovery does not create a deny-all policy.
- **Decline or cancel a prompt:** writes neither permissions nor guidance.
- **`--dry-run`:** performs discovery and selection, previews permissions and guidance, and writes neither file.


### Review existing permissions

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: @tanstack/intent@latest install --review
solid: @tanstack/intent@latest install --review
vue: @tanstack/intent@latest install --review
svelte: @tanstack/intent@latest install --review
angular: @tanstack/intent@latest install --review
lit: @tanstack/intent@latest install --review

<!-- ::end:tabs -->

Review starts from the current `intent.skills` rules. Continue with them, add packages/scopes/individual skills, remove explicit rules, or review individual skills within enabled packages. Existing rules stay intact unless you change them, including rules for packages or skills that are **not discovered**. Removing a rule requires unchecking it; Intent never removes it automatically.

**Inspect access and descriptions** shows whether each current candidate is permitted by a matching rule or blocked by the allowlist or `intent.exclude`. Searchable lists show at most six options at a time; descriptions appear on request. Package and scope rules continue to cover future matching skills. Adding a skill already covered by an existing rule does not add a redundant permission.

Unchecking a skill covered by a broader rule adds an exclusion. Existing exclusions stay in effect and cannot be removed through this picker; use [`intent exclude`](./intent-exclude) from the directory containing the exclusion to remove one.

The confirmation previews the destination, additions, removals, and new exclusions. Choose **Show exact proposed configuration** in the review menu for complete arrays. Canceling writes neither permissions nor guidance. `--review --dry-run` walks through review and prints the preview without saving either file.

In a workspace, inherited permissions are the starting selection. If you change them, confirmation creates an override in the nearest owning `package.json`; it does not edit the ancestor. Continuing unchanged preserves inheritance. Inherited exclusions still apply. If a policy manifest changes during review, the command stops and asks you to retry.

Review requires a terminal and cannot be combined with `--map`, `--print-prompt`, `--global`, or `--global-only`. With no effective policy, `--review` opens first-run setup. Plain `install` retains its guidance-only behavior for configured projects.

Review scans local candidates once and reuses that result throughout the prompts and completion counts. It compares current permissions with proposed edits. It does **not** detect newly discovered skills relative to an earlier run, content changes, hashes, or delivery drift. Permissions and guidance results are reported separately; a guidance failure after saving does not undo confirmed permissions.

### Mapping mode

- Scans packages and writes compact `id`, `run`, and `for` mappings only when `--map` is passed.
- Surfaces packages permitted by `package.json#intent.skills` in `--map` mode. See [Configuration](../concepts/configuration).
- Skips reference, meta, maintainer, and maintainer-only skills in `--map` mode.
- Writes compact skill identities and runnable guidance commands instead of local file paths in `--map` mode.
- Prints `No intent-enabled skills found.` and does not create a config file when `--map` finds no actionable skills.

Supported config files: `AGENTS.md`, `CLAUDE.md`, `.cursorrules`, `.github/copilot-instructions.md`.

## Default output

The managed `intent-skills` block instructs agents to discover skills with `intent list`, load matching guidance with `intent load`, and apply it before editing. It tells agents to work from the workspace root, prefer the most specific local skill, and load additional skills only when the task spans multiple concerns. Generated commands use the detected package manager's runner with `@tanstack/intent@latest`.

## Mapping output

`--map` writes a `tanstackIntent` list inside the managed `intent-skills` block. Each mapping contains:

- `id`: portable skill identity in `<package>#<skill>` format
- `run`: package-manager-aware command agents should run before editing
- `for`: task-routing phrase for agents
- The block does not store `load` paths, absolute paths, or package-manager-internal paths

## Status messages

| Result | Message |
| --- | --- |
| Mapping created | `Created AGENTS.md with 1 mapping.` |
| Mappings updated | `Updated AGENTS.md with 2 mappings.` |
| Mappings unchanged | `No changes to AGENTS.md; 2 mappings already current.` |
| Guidance created | `Created AGENTS.md with skill loading guidance.` |
| Guidance unchanged | `No changes to AGENTS.md; skill loading guidance already current.` |
| Permissions updated | `Permissions: updated package.json.` |
| Permissions canceled | `Permissions: canceled.` |
| Guidance result after setup | `Guidance: created AGENTS.md.` |
| Guidance failure after setup | `Guidance: failed: <error>` |
| Placement tip | `Tip: Keep the intent-skills block near the top of AGENTS.md so agents read it before task-specific instructions.` |
| No actionable skills in `--map` mode | `No intent-enabled skills found.` |

To suppress trust and migration notices in automation, pass `--no-notices`.

## Related

- [intent list](./intent-list)
- [intent load](./intent-load)
- [intent hooks](./intent-hooks)
- [Quick Start for Consumers](../getting-started/quick-start-consumers)
