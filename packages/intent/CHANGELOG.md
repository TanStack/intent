# @tanstack/intent

## 0.0.32

### Patch Changes

- Add compact skill mappings and runtime resolution for agent config setup. ([#115](https://github.com/TanStack/intent/pull/115))

  `intent install` now writes verified `intent-skills` blocks with compact `when`/`use` entries instead of embedding `load` paths. This keeps generated config portable across npm, pnpm, Bun, and Deno node_modules layouts, including transitive/package-manager-internal installs.

  Add `intent resolve <package>#<skill>` to resolve compact mappings to the installed skill path at runtime, with `--json`, `--global`, and `--global-only` support. `intent list`, `intent install`, and `intent resolve` now scan local project packages by default and require explicit global flags for global package scanning.

## 0.0.31

### Patch Changes

- Refactor package discovery into a dedicated registrar and dependency walker so project, workspace, and transitive dependencies are scanned consistently. Track local vs. global package sources and surface that in `intent list` via a `SOURCE` column. `intent stale` is now scoped to local and workspace packages; global packages are only included by `intent list` (which explicitly opts in). A new `scanForIntents` option `includeGlobal` controls global scanning for programmatic callers — this replaces the previous implicit behavior where setting `INTENT_GLOBAL_NODE_MODULES` caused all commands to scan globals. ([#112](https://github.com/TanStack/intent/pull/112))

## 0.0.30

### Patch Changes

- Fix skill discovery so skills nested under intermediate grouping directories (directories without their own SKILL.md) are found by the scanner. ([#109](https://github.com/TanStack/intent/pull/109))

## 0.0.28

### Patch Changes

- Read local package.json version before falling back to npm registry in `intent stale`. This fixes version drift detection for packages not published to public registry.npmjs.org (e.g. GitHub Packages, Artifactory, private registries). ([#104](https://github.com/TanStack/intent/pull/104))

- - Added Deno monorepo setup coverage so setup-github-actions writes workflows at the workspace root and preserves monorepo-aware path substitutions. ([#106](https://github.com/TanStack/intent/pull/106))

- Fix intent stale so monorepo package paths resolve to the targeted workspace package instead of scanning the whole workspace. ([#102](https://github.com/TanStack/intent/pull/102))

## 0.0.26

### Patch Changes

- - Fix workspace package discovery for nested glob patterns, including support for `*` and `**`. Workspace patterns and resolved package roots are now normalized, deduped, and sorted, and the shared resolver has been extracted for reuse by internal workspace scanning. ([#93](https://github.com/TanStack/intent/pull/93)) ([#100](https://github.com/TanStack/intent/pull/100))
  - Refactor @tanstack/intent to use a shared project context resolver for workspace and package detection. This fixes monorepo targeting bugs in validate and edit-package-json, including pnpm workspaces defined only by pnpm-workspace.yaml. ([#93](https://github.com/TanStack/intent/pull/93))
  - Use stable `node_modules/<name>/...` paths for skill references instead of absolute filesystem paths containing package-manager-internal directories with version numbers. Paths no longer break when packages are updated. ([#94](https://github.com/TanStack/intent/pull/94))

## 0.0.25

### Patch Changes

- - Fix workspace package discovery for nested glob patterns, including support for `*` and `**`. Workspace patterns and resolved package roots are now normalized, deduped, and sorted, and the shared resolver has been extracted for reuse by internal workspace scanning. ([#93](https://github.com/TanStack/intent/pull/93)) ([#99](https://github.com/TanStack/intent/pull/99))
  - Refactor @tanstack/intent to use a shared project context resolver for workspace and package detection. This fixes monorepo targeting bugs in validate and edit-package-json, including pnpm workspaces defined only by pnpm-workspace.yaml. ([#93](https://github.com/TanStack/intent/pull/93))
  - Use stable `node_modules/<name>/...` paths for skill references instead of absolute filesystem paths containing package-manager-internal directories with version numbers. Paths no longer break when packages are updated. ([#94](https://github.com/TanStack/intent/pull/94))

## 0.0.24

### Patch Changes

- Fix workspace package discovery for nested glob patterns, including support for `*` and `**`. Workspace patterns and resolved package roots are now normalized, deduped, and sorted, and the shared resolver has been extracted for reuse by internal workspace scanning. ([#93](https://github.com/TanStack/intent/pull/93))

- Refactor @tanstack/intent to use a shared project context resolver for workspace and package detection. This fixes monorepo targeting bugs in validate and edit-package-json, including pnpm workspaces defined only by pnpm-workspace.yaml. ([#93](https://github.com/TanStack/intent/pull/93))

- Use stable `node_modules/<name>/...` paths for skill references instead of absolute filesystem paths containing package-manager-internal directories with version numbers. Paths no longer break when packages are updated. ([#94](https://github.com/TanStack/intent/pull/94))

## 0.0.22

### Patch Changes

- Refactored the CLI to use `cac`, replacing the previous hand-rolled parsing and dispatch logic with a more structured command system. ([#85](https://github.com/TanStack/intent/pull/85))

  This update also fixes monorepo workflow generation behavior related to `setup-github-actions`, improving repo/package fallback handling and ensuring generated workflow watch paths are monorepo-aware.

## 0.0.21

### Patch Changes

- Replace hardcoded `TanStack/intent` dispatch target in `notify-intent.yml` template with `${{ github.repository }}` so the workflow works for any repo, not just TanStack org libraries. ([#82](https://github.com/TanStack/intent/pull/82))

- Replace bin.intent detection with tanstack-intent keyword check for package discovery. Remove the `add-library-bin` command and bin shim generation system — packages are now identified by having `"tanstack-intent"` in their keywords array, which was already required for registry discovery. Also fix `collectPackagingWarnings` to skip the `!skills/_artifacts` warning for monorepo packages. ([#81](https://github.com/TanStack/intent/pull/81))

- Make `scanForIntents` and `scanLibrary` synchronous instead of returning Promises for purely synchronous work. Clean up unnecessary async/await throughout source and tests, extract DRY test helpers, and improve type narrowing. ([#55](https://github.com/TanStack/intent/pull/55))

- Add workspace-aware scanning so `intent list` discovers skills in monorepo workspace packages when run from the root. Replace `resolveDepDir` with `createRequire`-based resolution that handles hoisted deps, pnpm symlinks, and export maps. The `resolveDepDir` public API signature changed from 4 parameters to 2 — callers using the old signature should update to `resolveDepDir(depName, parentDir)`. `detectPackageManager` now checks workspace root for lockfiles when scanning from a subdir. ([#79](https://github.com/TanStack/intent/pull/79))

- Improves the intent CLI with better setup validation, clearer feedback, version conflict detection, and improved monorepo support. ([#72](https://github.com/TanStack/intent/pull/72))

## 0.0.18

### Patch Changes

- Add `tanstack-intent` keyword to package.json during setup ([#63](https://github.com/TanStack/intent/pull/63))

- Make `edit-package-json` and `add-library-bin` monorepo-aware: when run from a monorepo root, they discover workspace packages containing SKILL.md files and apply changes to each package's package.json. Also improve domain-discovery skill to read in-repo docs before interviewing and avoid asking factual questions the agent can answer by searching the codebase. ([#67](https://github.com/TanStack/intent/pull/67))

## 0.0.17

### Patch Changes

- rename notify-playbooks.yml to notify-intent.yml ([#60](https://github.com/TanStack/intent/pull/60))

## 0.0.16

### Patch Changes

- enhance SKILL.md with detailed guidance on leveraging GitHub issues and discussions for skill improvement ([#56](https://github.com/TanStack/intent/pull/56))

## 0.0.15

### Patch Changes

- enhance SKILL.md with detailed guidance on leveraging GitHub issues and discussions for skill improvement ([#56](https://github.com/TanStack/intent/pull/56))

## 0.0.14

### Patch Changes

- Fix scanner to discover transitive dependencies with skills in non-hoisted layouts (pnpm). Add dependency tree walking via `resolveDepDir` that resolves packages through the pnpm virtual store. Also handle shim import errors gracefully when `@tanstack/intent` is not installed, and use `@latest` in all npx commands to avoid local binary conflicts. ([#46](https://github.com/TanStack/intent/pull/46))

## 0.0.11

### Patch Changes

- Replace `intent setup` with three focused commands: `intent add-library-bin`, `intent edit-package-json`, and `intent setup-github-actions`. The new `edit-package-json` command automatically wires the `files` array and `bin` field, handling existing CLIs (both object and string shorthand forms) without clobbering them. Improve meta skill SKILL.md files based on real scaffolding feedback: soften lightweight path threshold, add companion library and experimental features questions, add YAML validation step, add subagent guidance for parallel generation, and replace inline feedback sections with a pointer to the feedback-collection skill. ([#37](https://github.com/TanStack/intent/pull/37))

- 3 files changed in packages/playbooks/meta/ ([#33](https://github.com/TanStack/intent/pull/33))

  domain-discovery/SKILL.md (681 → ~792 lines)
  - Added "Hard rules" section: 7 mandatory rules enforcing interactive interviews, prohibiting docs-as-substitute, question collapsing, and interview skipping
  - Added 3 STOP gates between phases (1→2, 3→4, and after Phase 2d skill list confirmation)
  - Strengthened Phase 2 & 4 headers with explicit interactivity requirements and "wait for response" instructions
  - Added Phase 3 thoroughness: file checklist before reading, read-all enforcement, peer dependency analysis in Phase 1b
  - Added 7 new constraint table rows for interview interactivity
  - Updated cross-model compatibility notes with STOP gate and question protection rationale
  - Added cross-package monorepo question in Phase 2a
  - Added packages field to domain_map.yaml schema (package-relative ownership model)
  - Softened feedback section to alpha-temporary
  - tree-generator/SKILL.md (859 → ~898 lines)
  - Strengthened compressed discovery warning (requires maintainer confirmation to skip)
  - Added packages field to skill_tree.yaml schema
  - Added monorepo placement section with concrete directory tree example showing skills inside each package
  - Added STOP gate after Step 1 (file tree review before writing)
  - Added STOP gate after Step 8 (validation results review)
  - Added 2 new constraint rows (file tree reviewed, validation presented)
  - Softened feedback section to alpha-temporary
  - generate-skill/SKILL.md (419 → ~441 lines)
  - Added packages field to frontmatter template
  - Added monorepo path guidance: skills ship inside each package, not repo root
  - Added STOP gate in Step 6: first skill reviewed before generating batch
  - Added first-skill-reviewed constraint row
  - Softened feedback section to alpha-temporary

## 0.1.0

### Patch Changes

- Add `intent-library` end-user CLI for library consumers. Libraries wire it up via a generated shim (`intent setup --shim`) to expose an `intent` bin. Running `intent list` recursively discovers skills across the library's dependency tree; `intent install` prints an agent-driven prompt to map skills to project tasks in CLAUDE.md. ([#9](https://github.com/TanStack/intent/pull/9))
