---
title: intent maintainer
id: intent-maintainer
---

`intent maintainer` provides one command workflow for creating, maintaining, and distributing library skills. Skills stay in their owning packages. The commands keep registrations and generated metadata consistent; maintainers and coding agents supply the task knowledge and review conclusions.

## Commands

| Command | What it does |
| --- | --- |
| `maintainer setup` | Install repository guidance, create missing planning records, and save the distribution choice. |
| `maintainer adopt` | Review and register existing package-owned skills with interactive confirmation or an explicit JSON plan. |
| `maintainer add <name>` | Create a skill skeleton or register an existing skill in the cumulative record. |
| `maintainer status` | Show authoring gaps, stale generated files, and pending source reviews. |
| `maintainer sync` | Align tree metadata, package publishing entries, plugin manifests, and consumer install commands. |
| `maintainer review` | Inspect Git changes and record supplied outcomes against content fingerprints. |
| `maintainer check` | Check skill structure, registration, generated metadata, and recorded reviews locally or in CI. |
| `maintainer verify-package <archive.tgz>` | Check registered skills and resources in the supplied package archive without extracting or executing it. |

The former `scaffold` command is removed. Use `maintainer setup` and `maintainer add` for file creation, and `meta generate-skill` for the authoring procedure.

## Setup

Run from a Git working tree containing the library's package manifest:

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: @tanstack/intent@latest maintainer setup
solid: @tanstack/intent@latest maintainer setup
vue: @tanstack/intent@latest maintainer setup
svelte: @tanstack/intent@latest maintainer setup
angular: @tanstack/intent@latest maintainer setup
lit: @tanstack/intent@latest maintainer setup

<!-- ::end:tabs -->

Setup preserves existing documents and repository instructions. Standalone packages use `skills/_artifacts/`; monorepos share `_artifacts/` at the repository root. An existing custom location is retained. If several locations exist, select one with `--artifacts <repository-relative-directory>`.

The three records have separate jobs:

| Record | Owns |
| --- | --- |
| `domain_map.yaml` | Domains, developer tasks, supported failure modes, and knowledge gaps. |
| `skill_spec.md` | Coverage, maintainer decisions, check results, and batch history. |
| `skill_tree.yaml` | Skill identities, owning packages, paths, source mappings, prerequisites, and the distribution choice. |

Generated skeletons remain unfinished. Author their contents and remove the `intent:needs-authoring` marker after completing that work. A successful setup command does not mean the skills are ready to publish.

For an existing library, use [guided adoption](./intent-adopt) to register its current skills without rewriting their content. Reviewers can use [interactive review](./intent-review#interactive-review) in a human terminal; CI uses the noninteractive checks.

## Add a skill

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: @tanstack/intent@latest maintainer add retries --package packages/client --domain requests --description "Use when configuring retries with this client." --source "src/retry.ts"
solid: @tanstack/intent@latest maintainer add retries --package packages/client --domain requests --description "Use when configuring retries with this client." --source "src/retry.ts"
vue: @tanstack/intent@latest maintainer add retries --package packages/client --domain requests --description "Use when configuring retries with this client." --source "src/retry.ts"
svelte: @tanstack/intent@latest maintainer add retries --package packages/client --domain requests --description "Use when configuring retries with this client." --source "src/retry.ts"
angular: @tanstack/intent@latest maintainer add retries --package packages/client --domain requests --description "Use when configuring retries with this client." --source "src/retry.ts"
lit: @tanstack/intent@latest maintainer add retries --package packages/client --domain requests --description "Use when configuring retries with this client." --source "src/retry.ts"

<!-- ::end:tabs -->

Omit `--package` for a standalone package or a repository-owned discovery skill. The default path is `skills/<name>/SKILL.md` within that package. Use `--path <package-relative-path>/SKILL.md` for an established layout. Repeat `--source` and `--requires` to supply multiple paths or prerequisites.

To register existing guidance, supply its name, domain, package, and path. The command reads its frontmatter and preserves the file. To change an already registered skill, edit its guidance and run `maintainer sync`.

Registration updates the tree and domain map and appends an entry to the spec. Write the task coverage, source-backed guidance, and consequential decisions; the command does not infer them.

## Choose repository distribution

Package skills can also be offered through GitHub installers and native plugins. Select the registered skills explicitly:

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: @tanstack/intent@latest maintainer setup --distribution repo --repository owner/library --skill discover-library --skill retries
solid: @tanstack/intent@latest maintainer setup --distribution repo --repository owner/library --skill discover-library --skill retries
vue: @tanstack/intent@latest maintainer setup --distribution repo --repository owner/library --skill discover-library --skill retries
svelte: @tanstack/intent@latest maintainer setup --distribution repo --repository owner/library --skill discover-library --skill retries
angular: @tanstack/intent@latest maintainer setup --distribution repo --repository owner/library --skill discover-library --skill retries
lit: @tanstack/intent@latest maintainer setup --distribution repo --repository owner/library --skill discover-library --skill retries

<!-- ::end:tabs -->

The repository is inferred from package metadata when available. `--plugin-name <name>` can choose the initial plugin name. New skills are never added to the selection automatically, and local prerequisites must be selected explicitly.

To keep the package distribution workflow without generating repository exports:

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: @tanstack/intent@latest maintainer setup --distribution none
solid: @tanstack/intent@latest maintainer setup --distribution none
vue: @tanstack/intent@latest maintainer setup --distribution none
svelte: @tanstack/intent@latest maintainer setup --distribution none
angular: @tanstack/intent@latest maintainer setup --distribution none
lit: @tanstack/intent@latest maintainer setup --distribution none

<!-- ::end:tabs -->

Setup remembers this choice. `maintainer check` reports an unconfigured choice until either option is recorded.

After authoring, `maintainer sync` updates Claude and Cursor plugin manifests and marketplace entries that point to the existing skill directories. It preserves unrelated plugin fields and other marketplace entries. It writes `.intent/skill-distribution.json` with source paths and install arguments, and prints commands consumers can copy. Conflicting plugin identities or source roots require resolution before synchronization writes anything.

An existing Claude marketplace entry with `strict: false` conflicts with the generated component manifest. Sync rejects it before writing. Keep the existing policy until the maintainer decides to use `strict: true` or omit the field.

Opting out after exports exist clears the selected paths and Intent's marketplace entry on the next sync. Other plugin features and source skills remain. This does not revoke installed copies or hide public GitHub files.

### Consumer choices

- Use the generated `npx skills add owner/library --full-depth --skill <names>` command for a selected set, or `gh skill add owner/library <exact-SKILL.md-path>` for an individual skill. Full-depth discovery finds package skills even when the repository has root or agent-directory skills; the named selection still limits what is installed.
- Install the generated marketplace through Claude Code or Cursor's native plugin flow.
- Install the npm package and use Intent's existing `list`, `install`, and `load` commands for its bundled version of the guidance.

Repository location and installation scope are separate choices. The skill installers default to project scope; consumers can explicitly choose user scope with `--global` for `skills` or `--scope user` for `gh`. Third-party tools retain their own discovery behavior: a full scan or `--all` may expose other public skills. Use the generated selection or exact paths for a curated subset.

A discovery skill can help someone decide whether a library fits before they install it. Keep that guidance about supported tasks and setup choices, respect the project's chosen stack, and hand API implementation to the installed package's skills and source. Avoid maintaining another copy of version-sensitive API instructions in the discovery skill.

### Releases and updates

Generated commands do not pin a revision or match the application's installed dependency versions. Each installer resolves its own default source. For a specific release, add `--pin <tag-or-sha>` to the generated GitHub command, use `https://github.com/owner/library/tree/<ref>` as the `skills add` source, or add a Claude marketplace from `owner/library@<tag>`. Verify that the selected paths exist at that revision.

Intent preserves existing plugin version fields. Claude uses an explicit plugin version to decide whether an update is available: bump the authoritative plugin version when releasing changed content. Without a version in either the plugin or its marketplace entry, Git-based Claude installs use the source commit. Updating an npm package version alone does not update plugin metadata.

Publish through the library's normal release process. Repository exports do not submit marketplace listings, publish releases, or update consumer installations. State the supported package versions in implementation skills and check them against the consumer's dependencies. Consumers manage updates and removal through their chosen installer.

## Maintain and check

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: @tanstack/intent@latest maintainer status
react: @tanstack/intent@latest maintainer sync
react: @tanstack/intent@latest maintainer review --json
solid: @tanstack/intent@latest maintainer status
solid: @tanstack/intent@latest maintainer sync
solid: @tanstack/intent@latest maintainer review --json
vue: @tanstack/intent@latest maintainer status
vue: @tanstack/intent@latest maintainer sync
vue: @tanstack/intent@latest maintainer review --json
svelte: @tanstack/intent@latest maintainer status
svelte: @tanstack/intent@latest maintainer sync
svelte: @tanstack/intent@latest maintainer review --json
angular: @tanstack/intent@latest maintainer status
angular: @tanstack/intent@latest maintainer sync
angular: @tanstack/intent@latest maintainer review --json
lit: @tanstack/intent@latest maintainer status
lit: @tanstack/intent@latest maintainer sync
lit: @tanstack/intent@latest maintainer review --json

<!-- ::end:tabs -->

Status accepts `--json` and an actual Git comparison base with `--base <ref>`. Sync copies descriptions, purpose, sources, and prerequisites from the registered skills into the tree. It also adds the package discovery keyword and includes skill directories in existing `files` allowlists. An absent allowlist stays absent, preserving npm's default contents. Inspect the actual packed archive in the library's release checks.

Save the review report under `.intent/`, annotate completed items with an outcome, reason, and actual evidence, then record and check:

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: @tanstack/intent@latest maintainer review --record .intent/review.json
react: @tanstack/intent@latest maintainer check
solid: @tanstack/intent@latest maintainer review --record .intent/review.json
solid: @tanstack/intent@latest maintainer check
vue: @tanstack/intent@latest maintainer review --record .intent/review.json
vue: @tanstack/intent@latest maintainer check
svelte: @tanstack/intent@latest maintainer review --record .intent/review.json
svelte: @tanstack/intent@latest maintainer check
angular: @tanstack/intent@latest maintainer review --record .intent/review.json
angular: @tanstack/intent@latest maintainer check
lit: @tanstack/intent@latest maintainer review --record .intent/review.json
lit: @tanstack/intent@latest maintainer check

<!-- ::end:tabs -->

The [source-review reference](./intent-review) describes the report format, fingerprints, and baseline recovery. `maintainer review` supports its `--base`, `--json`, and `--record` options. The standalone `review` command also remains available for workflow reminder output and review-only checks.

`maintainer check --base <pull-request-base>` runs the same maintainer checks in CI. It does not publish, install consumer skills, or certify that an agent's recorded conclusion is correct. Missing task evidence remains a review responsibility.

After the normal package build, use [archive verification](./intent-verify-package) against the actual release tarball. Repository validation and archive verification protect different stages; neither executes an authoring model in CI.

## Verify distribution

Before releasing a library's exports, install the selected skills in disposable consumer projects through every advertised route. Check the installed names, bundled references and scripts, supported package versions, update behavior, and removal. Opting out in the source repository must not be described as removing consumer copies.

Use each host's native plugin flow, including [Cursor](https://cursor.com/docs/reference/plugins). Inspect all loaded components: the repository root becomes the plugin root, so preserved or automatically discovered commands, agents, hooks, and MCP configuration are not limited by the skill selection. Run a real consumer task; valid metadata does not establish correct guidance.

When changing Intent's distribution implementation, run the [contributor compatibility gate](https://github.com/TanStack/intent/blob/main/CONTRIBUTING.md#distribution-compatibility). That guide owns the required tools, verified versions, and automated checks.

Cursor acceptance and agent task quality remain separate checks. Record an unavailable host or missing task evidence as incomplete, even when the automated gate passes.

## Related

- [Maintainer quick start](../getting-started/quick-start-maintainers)
- [Source review](./intent-review)
- [CI setup](./intent-setup)
- [Publishing and registry discovery](../registry)
