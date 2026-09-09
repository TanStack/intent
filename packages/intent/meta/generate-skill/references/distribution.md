# Offer skills from the repository

Read this when setting up maintainer workflow or preparing skills for consumers who use GitHub skill installers or plugins. Keep the authoritative skills beside their owning package's code. Repository distribution generates metadata pointing to those directories; it does not copy the skill text into a second tree.

## Record the maintainer's choice

`intent maintainer setup` explains repository distribution until a choice is saved. For selected repository skills, run:

```sh
intent maintainer setup --distribution repo --skill discover-library --skill query
```

Use the actual registered skill names. The repository is read from package metadata; supply `--repository owner/repo` when it cannot be established. `--plugin-name` chooses an initial plugin name when the default is unsuitable. To keep only the existing package distribution workflow, run:

```sh
intent maintainer setup --distribution none
```

The choice lives under `distribution` in `skill_tree.yaml`. Repeated setup preserves it. Adding a skill never adds it to the public selection. If an exported skill requires another local skill, include that prerequisite explicitly; the generator does not silently expand the selection. Preserve prior decisions in the spec. The domain map continues to describe tasks and knowledge, not installer configuration.

## Generate and check

After authoring, run `intent maintainer sync`. It updates `skills` paths in `.claude-plugin/plugin.json` and `.cursor-plugin/plugin.json`, and the matching root-source entry in each `marketplace.json`. It preserves unrelated plugin fields and other marketplace entries, and rejects conflicting plugin identities or source roots. It also writes `.intent/skill-distribution.json` with the selected source paths and install arguments, and prints copyable consumer commands. Commit the generated metadata alongside the tree and skills through the repository's normal review process.

`intent maintainer status` reports stale generated files; `--json` also includes the saved distribution choice and consumer commands. `intent maintainer check` requires a recorded choice and synchronized exports alongside the existing authoring and source-review checks. Rerun source review after synchronization so the report covers the final files. Opting out after generating exports clears Intent's selected paths and its marketplace entry on the next sync, retaining unrelated plugin features. It does not revoke already installed copies or make public GitHub files private.

## Explain the consumer options

- **Before package installation:** a discovery skill can explain the developer tasks a library supports and help decide whether it fits the project. Respect the chosen stack and existing dependencies. Make any package installation a deliberate project change, then hand off API implementation to the installed version's skills and source. Avoid embedding a second set of version-sensitive API instructions in the discovery skill.
- **Installed package guidance:** consumers can keep using Intent's `list`, `install`, and `load` workflow for skills shipped with the package version they installed.
- **GitHub skill installers:** use the generated `npx skills add owner/repo --skill <selected-names>` or `gh skill add owner/repo <exact-SKILL.md-path>` commands. Their default installation scope is the project. User scope is a separate consumer choice (`--global` for skills, `--scope user` for gh). Repository source location and installation scope are separate concepts.
- **Plugins:** use the generated marketplace metadata with Claude Code or Cursor's native plugin installation. The plugin references the selected package directories; it does not require Intent to invoke those skills.

The generated selection controls Intent's exported metadata and suggested install commands. Third-party installers retain their own discovery rules; a full repository scan or explicit `--all` can expose other public skills. Use the named selection or exact paths when distributing a curated subset. Check references from the installed skill directory and test the actual consumer task separately: copying a skill does not prove that all its links or recommendations are portable.

Publish through the library's normal npm/GitHub release process. `gh skill publish --dry-run` can validate a GitHub skill release without publishing it; actual releases remain a maintainer action. skills.sh indexes public GitHub skills through real installation usage; there is no submission API used by Intent. Do not simulate installations to create a listing.

## Verify installer compatibility

The repository's optional `tests/integration/distribution-installers.test.ts` exercises generated metadata with real CLIs. Build Intent, then set `INTENT_GH_SKILL_BIN` and `INTENT_SKILLS_BIN` to installed executables and run that test. It installs only a selected nested package skill into temporary consumer projects, checks its bundled reference, and runs `gh skill publish --dry-run`. Telemetry is disabled. It does not install user-level skills, publish a release, or prove native plugin activation or agent task quality.

Primary format references: [skills CLI](https://github.com/vercel-labs/skills), [GitHub skill install](https://cli.github.com/manual/gh_skill_install), [Claude plugin paths](https://code.claude.com/docs/en/plugins-reference#path-behavior-rules), and [Cursor plugins](https://cursor.com/docs/reference/plugins).
