# Offer skills from the repository

Keep authoritative skills beside their owning package's code. Generate distribution metadata for those directories instead of maintaining another copy of the guidance.

## Record the maintainer's choice

Package-only distribution is the default; `intent maintainer setup` mentions repository distribution until a choice is saved, and nothing requires one. For selected repository skills, run:

```sh
intent maintainer setup --distribution repo --skill discover-library --skill query
```

Use the actual registered skill names. The repository is read from package metadata; supply `--repository owner/repo` when it cannot be established. `--plugin-name` chooses an initial plugin name when the default is unsuitable. To record the package-only default explicitly, so later sessions do not raise the option again, run:

```sh
intent maintainer setup --distribution none
```

The choice lives under `distribution` in `skill_tree.yaml`. Repeated setup preserves it. Adding a skill never adds it to the public selection. If an exported skill requires another local skill, include that prerequisite explicitly; the generator does not silently expand the selection. Preserve prior decisions in the spec. The domain map continues to describe tasks and knowledge, not installer configuration.

## Generate and check

Run `intent maintainer sync` after authoring. Inspect `skills` paths in `.claude-plugin/plugin.json`, `.cursor-plugin/plugin.json`, and the matching root-source marketplace entries. They must match the saved selection; unrelated plugin fields and marketplace entries must survive. Resolve conflicting plugin identities or source roots before syncing. Inspect `.intent/skill-distribution.json` and the printed consumer commands, then keep the generated metadata alongside the tree and skills for repository review.

`intent maintainer status` reports stale generated files; `--json` also includes the saved distribution choice and consumer commands. `intent maintainer check` requires synchronized exports for a recorded repository selection alongside the existing authoring and source-review checks. Rerun source review after synchronization so the report covers the final files. Opting out after generating exports clears Intent's selected paths and its marketplace entry on the next sync, retaining unrelated plugin features. It does not revoke already installed copies or make public GitHub files private.

## Explain the consumer options

- **Before package installation:** a discovery skill can explain the developer tasks a library supports and help decide whether it fits the project. Respect the chosen stack and existing dependencies. Make any package installation a deliberate project change, then hand off API implementation to the installed version's skills and source. Avoid embedding a second set of version-sensitive API instructions in the discovery skill.
- **Installed package guidance:** consumers can keep using Intent's `list`, `install`, and `load` workflow for skills shipped with the package version they installed.
- **GitHub skill installers:** use the generated `npx skills add owner/repo --full-depth --skill <selected-names>` or `gh skill add owner/repo <exact-SKILL.md-path>` commands. `--full-depth` finds package skills even when root or agent-directory skills exist; `--skill` still limits the selection. Their default installation scope is the project. User scope is a separate consumer choice (`--global` for skills, `--scope user` for gh). Repository source location and installation scope are separate concepts.
- **Plugins:** use the generated marketplace metadata with Claude Code or Cursor's native plugin installation. The plugin references the selected package directories; it does not require Intent to invoke those skills.

The generated selection controls Intent's exported metadata and suggested install commands. Third-party installers retain their own discovery rules; a full repository scan or explicit `--all` can expose other public skills. Use the named selection or exact paths when distributing a curated subset. Check references from the installed skill directory and test the actual consumer task separately: copying a skill does not prove that all its links or recommendations are portable.

Publish through the library's normal npm/GitHub release process. `gh skill publish --dry-run` can validate a GitHub skill release without publishing it; actual releases remain a maintainer action. skills.sh indexes public GitHub skills through real installation usage; there is no submission API used by Intent. Do not simulate installations to create a listing.

## Versions and updates

- Generated commands do not pin a release. Each installer resolves its own default source; the selected skill names do not select the application's installed package version.
- For release-specific installs, use `gh skill add owner/repo <exact-SKILL.md-path> --pin <tag-or-sha>`, a GitHub `https://github.com/owner/repo/tree/<ref>` source for `skills add`, or a Claude marketplace source such as `owner/repo@<tag>`. Verify that the selected paths exist at that revision before sharing the command.
- Intent preserves existing plugin `version` fields. If a Claude plugin declares a version, bump its authoritative version on each plugin release; unchanged versions keep consumers on the cached content. If neither the plugin nor its marketplace entry declares a version, Git-based Claude installs use the source commit. An npm package version change does not update plugin metadata.
- Check externally installed implementation guidance against the application's dependencies. Record supported package versions in the skill; do not present repository distribution as automatic package-version matching. Consumers own their installer updates and removal. Maintainer opt-out does not remove their installed copies.
- A Claude marketplace entry with `strict: false` conflicts with the generated component manifest. Resolve it with the maintainer before syncing: use `strict: true` or omit the field. Intent rejects the conflict without changing the existing policy.

## Verify and hand off

1. Install the selected skills in disposable consumer projects through each advertised installer and host. Check selected names and exclusion of unselected skills. For plugins, inspect all loaded components: the repository root is the plugin root, so preserved or automatically discovered commands, agents, hooks, and MCP configuration are not limited by the skill selection.
2. Resolve required references from the installed skill directory and execute bundled helpers with valid and invalid inputs. Check runtime requirements against the consumer environment. Proceed when the required files and tools work outside the source checkout.
3. Test updates and removal through the chosen installer. Use the native [Claude](https://code.claude.com/docs/en/plugin-marketplaces#validation-and-testing) or [Cursor](https://cursor.com/docs/reference/plugins) flow to check plugin activation and changed versions. Verify that source opt-out clears generated exports without removing existing consumer copies.
4. Run an actual consumer task against the supported package version using the [task quality checks](task-quality.md). File copying and valid manifests establish packaging, not task correctness.
5. After the final sync, record supported outcomes through [source review](source-review.md) and run `intent maintainer check`. Report paths, revisions, host versions, check results, and missing evidence. The diff is ready for review when these checks pass; mark unavailable hosts or task evidence as incomplete. Publishing and commits require the maintainer's request.

For changed installer syntax or host formats, verify matching versions against the [skills CLI](https://github.com/vercel-labs/skills), [GitHub skill install](https://cli.github.com/manual/gh_skill_install), [Claude plugin paths](https://code.claude.com/docs/en/plugins-reference#path-behavior-rules), and [Cursor plugins](https://cursor.com/docs/reference/plugins) before changing consumer instructions.
