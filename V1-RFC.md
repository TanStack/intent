# RFC: TanStack Intent v1 — Security, Lockfile & MCP

**Status:** Open for comment — for maintainer review before implementation.
**Reading guide:** §0 is "state of the world today" — start here if you're not deeply familiar with the codebase. §1–4 are settled problem + context. §5–12 are the design. §13 contains the resolved decision audit trail.

> **Implementation status (verified 2026-06-13 against `main` @ `0.0.43`).** Track progress here; the living tracker lives in [V1-RELEASE-PLAN.md](V1-RELEASE-PLAN.md) §7.
>
> | Item | Status |
> | --- | --- |
> | §4 — `intent-library` cleanup | ✅ **done on `main`** (bin, `intent-library.ts`, `library-scanner.ts`, `library-scanner.test.ts` removed; no refs remain) |
> | M1 — explicit skill sources | ⬜ not started |
> | M2 — lockfile + frozen mode | ⬜ not started |
> | M3 — manifest + Agent Skills spec compliance (D20) | ⬜ not started |
> | M4 — capability-aware diff | ⬜ not started |
> | M5 — MCP server | ⬜ not started |
> | M6 — `security doctor` | ⬜ not started |
> | M7 Part B — staleness hardening (1.0 maintainer-reliability commitment) | ⬜ not started |
> | M7 Part A — maintainer agent surface (cut candidate, rides on M5) | ⬜ not started |
>
> Note: the `rfc` branch working tree is behind `main` (`0.0.41`) and still contains the removed `intent-library` files. The §4 statements below describe the work as originally scoped; confirm completion against `main`, not the branch.

---

## 0. State of the world today

> **Read this section first if you're not deeply familiar with the codebase.** It describes what `@tanstack/intent` actually is and how it works right now, so the problem statement and design in §1–§5 are grounded in something concrete.

### What is `@tanstack/intent`?

**TanStack Intent's goal is to make library knowledge available to AI coding agents — versioned, distributed through npm, and discovered automatically from a project's installed dependencies.** Library authors write `SKILL.md` files that teach agents how to use their library correctly; consumers get those skills for free just by installing the library.

`@tanstack/intent` (`v0.0.41` at time of writing) is the CLI that powers both sides of that contract:

- **Library authors** use it to author, validate, and publish skills. Skills are shipped inside the library's npm package under a `skills/` directory and versioned alongside the library's code.
- **Consumers** (app developers) use it to discover which skills are available from their installed dependencies and surface them to their AI coding agent.

The package ships a single CLI binary (`intent`) with today's commands:

| Command                       | Audience         | What it does                                                                               |
| ----------------------------- | ---------------- | ------------------------------------------------------------------------------------------ |
| `intent list`                 | Consumer         | Walks `node_modules` and prints every discovered skill                                     |
| `intent load <use>`           | Consumer / agent | Loads a specific `SKILL.md` and prints it to stdout (used by agent auto-loading)           |
| `intent install`              | Consumer         | Prints an agent setup snippet (edits to `.cursorrules`, GitHub Copilot instructions, etc.) |
| `intent meta [name]`          | Consumer         | Lists or prints meta-skills (skills that describe Intent itself)                           |
| `intent scaffold`             | Maintainer       | Scaffolds a new `skills/` directory with a starter `SKILL.md`                              |
| `intent validate`             | Maintainer       | Validates all `SKILL.md` files in the current package against the schema                   |
| `intent stale`                | Maintainer       | Checks whether skills are out-of-date with library version / source code                   |
| `intent edit-package-json`    | Maintainer       | Adds the `intent` field and `tanstack-intent` keyword to `package.json`                    |
| `intent setup-github-actions` | Maintainer       | Writes a CI workflow that validates and checks staleness                                   |

There is also `intent-library` (a second bin entry), but it is an **abandoned** code path — see §4.

### How a skill package looks today

A library that ships skills adds this to its `package.json`:

```jsonc
{
  "keywords": ["tanstack-intent"],
  "intent": {
    "version": 1,
    "repo": "TanStack/router",
    "docs": "https://tanstack.com/router",
    "requires": ["@tanstack/query"], // optional load-order hint
  },
}
```

Skills live in a `skills/` directory, one per subdirectory, each containing a `SKILL.md`:

```
skills/
  file-based-routing/
    SKILL.md
  search-params/
    SKILL.md
```

Each `SKILL.md` has YAML frontmatter:

```yaml
---
name: file-based-routing
description: How to define routes using the file-based routing convention
type: guide
framework: react
---
```

The `requires` array in `package.json#intent` is a **topological ordering hint only** — it controls the order in which skills are returned by `intent list`, not whether they are trusted.

### How consumer discovery works today (`scanner.ts`)

When a consumer runs `intent list`, `scanner.ts` does the following:

1. Finds the project root and detects the package manager (npm, pnpm, yarn classic, yarn PnP, bun, Deno w/ node_modules).
2. Walks `node_modules` (local and optionally global) looking for packages that either:
   - Have an explicit `package.json#intent` field that passes `validateIntentField()` (version=1, repo, docs), **or**
   - Have a `skills/` directory and standard `repository`/`homepage` fields that `deriveIntentConfig()` can derive a config from.
3. For each matching package, reads all `SKILL.md` files under `skills/` and builds a `SkillEntry` list.
4. Returns the full `ScanResult` including detected version conflicts across nested `node_modules`.

**There is no allowlist.** Any installed package that looks like a skill package is trusted and surfaced. The `tanstack-intent` keyword in `keywords[]` is only checked by the **abandoned** `library-scanner.ts` — `scanner.ts` (the live consumer path) does not check it at all.

### What already exists that v1 builds on

- **Version conflict detection** — `scanner.ts` already surfaces `VersionConflict[]` when the same skill package appears at multiple versions in nested `node_modules`.
- **Staleness checking** — `staleness.ts` already checks whether a skill's declared `libraryVersion` frontmatter field is behind the currently-installed package version, and classifies the drift as major/minor/patch.
- **Secret pattern detection** — `feedback.ts` already contains `SECRET_PATTERNS` regex set used to warn when skill content looks like it contains a literal secret value. v1 (M3) moves this to a shared `secrets.ts` module.
- **Workspace awareness** — `workspace-patterns.ts` already detects workspace roots and packages across npm, pnpm, yarn, and bun workspace layouts.
- **Static-only discovery** — `scanner.ts` is already static: it uses `readFileSync` and `createRequire().resolve()` only, never `await import()`. v1 codifies this as a lint-enforced invariant.
- **Exclude / blacklist** — `core/excludes.ts` already implements a subtractive filter. Consumers can suppress packages with `package.json#intent.exclude[]` (an array of package-name globs like `@scope/*` or `legacy-pkg`, merged from cwd up to the workspace root) and with the `--exclude <pattern>` CLI flag on `list`/`load`. v1 **must preserve this** (see §3) and extend it to skill-name granularity (see M1).

### What does NOT exist today (v1 adds these)

- ❌ An allowlist — any skill package is trusted today.
- ❌ A lockfile — there is no reproducible record of what was discovered and approved.
- ❌ Capability declarations — skills don't declare what they can do (read files, make network calls, etc.).
- ❌ An approval step — skills are surfaced to agents without any human review step.
- ❌ Frozen/CI mode — CI runs don't fail on drift or unexpected skill sources.
- ❌ An MCP server — agents must use `intent load` to fetch skills; there is no structured MCP interface.
- ❌ A manifest file — there is no hashable, stable artifact separate from `SKILL.md` content.

---

## 1. Problem

Today, `@tanstack/intent`'s consumer-facing scanner (`scanner.ts`) trusts any installed package that has a `skills/` directory and a derivable `intent` config (repo + docs, either explicit or derived from `repository`/`homepage`). It walks `node_modules` and workspace deps, reads `SKILL.md` content, and surfaces it to coding agents without any approval, lock, or capability gating. The `tanstack-intent` keyword exists, but it only gates registry indexing and the abandoned `library-scanner.ts` codepath — it does **not** gate consumer discovery.

That model works as long as the only skills in the world are from a small set of trusted authors. Once skills become a broader ecosystem (third-party packages, monorepo internal skills), Intent needs:

1. **Explicit trust** — the project declares which skill sources it uses.
2. **Reproducibility** — what was approved is what's loaded, byte-for-byte.
3. **Reviewable change** — content/capability/source changes require an approval step.
4. **Capability gating** — skills declare what they do (read, write, network, secrets, downloads, MCP tools), and consumers approve at that granularity.
5. **Non-interactive safety** — CI runs and the MCP server both operate in a frozen mode that fails on drift rather than prompting.

## 2. Distribution model (sets the trust boundary)

**Hard rule (preserved from prior design decisions):** library packages ship **data only** — `skills/` directory, manifest (M3), `keywords: ["tanstack-intent"]`. They **never** ship bins or runtime code. See §3.

- **Library authors** install `@tanstack/intent` as a **devDependency**. They author/validate/CI their skills locally. Maintainer-facing commands (`scaffold`, `skills validate`, `skills generate-manifest`, `edit-package-json`, `setup-github-actions`, `skills stale`) run from this devDep install.
- **Consumers** (app projects) reach Intent functionality by either:
  - Installing `@tanstack/intent` as a local project/workspace dependency, typically a **devDependency** (required for any project that commits `intent.lock` — keeps tooling pinned and reproducible), or
  - Running `npx @tanstack/intent@<exact-version>` for one-off discovery (`intent list`, `intent install`). Not suitable for lock-driven workflows; `intent skills scan/approve/diff/update`, `intent mcp serve`, and `intent security doctor` should always run from a pinned devDep install.
- The MCP server is `intent mcp serve` — same bin, runs from a local project/workspace install only (`npx`, `dlx`, global installs, and ephemeral package execution are not supported for `mcp serve` in v1). It is **not** shipped from inside library packages.
- **`intent.lock`** lives in the **consumer project root**, committed.
- Within `@tanstack/intent` itself, security-relevant logic lives in standalone modules (`scanner`, `lockfile`, `manifest`, `mcp`, `policy`, `secrets`) so commands stay thin and the same logic is reused across CLI, MCP, and tests.

### Source identity vs read location

**Resolved:** `intent.lock` stores stable source identity, not physical scanner paths.

The scanner may keep read locations internally (`node_modules`, pnpm store paths, Yarn PnP zip paths, workspace directories), but those paths are not part of the security identity. Lockfile entries use package identity (`id`, `kind`, `version`, optional package-manager `resolution`) and package-relative skill paths. Absolute cache paths and virtual package-manager paths never become approval identity.

This keeps approvals portable across package managers, CI caches, symlinks, and Yarn PnP.

### Standalone curated sources (reserved, post-M2)

**Resolved (D19):** a standalone curated/personal skills repository is a future **source kind** (`kind: git`), not a generic local-directory drop-zone. The kind is reserved in M1 and implemented after M2, because the property that makes it safe — pinning — lives in the lockfile.

This is the "skills travel with a package" model widened to one more intake, **not** a repositioning toward a generic skills installer (cf. skills.sh). The difference is mechanism: a generic installer _copies_ skills into a project and forgets where they came from; an Intent git source is _materialized from a pinned ref_ and stays tracked, versioned, and approvable. The git kind widens the intake, not the trust model.

When implemented (post-M2), a `git:` source:

- Is **materialized** into a gitignored managed directory (a derived cache under `.intent/`, the `node_modules`/`.pnpm-store` analogue — Intent fills it from a pinned source; it is never a hand-edited drop-zone the scanner blindly trusts).
- Has its identity recorded in `intent.lock` as the **pinned ref**, never the materialized path — exactly like npm `resolution` (e.g. `"resolution": "git:github.com/sarah/skills@<sha>"`). The materialized directory is a read location, not an approval identity (same rule as §_Source identity vs read location_).
- Flows through the identical lockfile lifecycle: stable identity (the ref), version (the sha/tag), `contentHash` over package-relative skill bytes, approval, and diff. It earns no trust shortcut over npm or workspace sources.

Unpinned, hand-dropped local skill directories remain **out of scope** (§14) — only a pinned source kind brings standalone skills into the trust model. If a developer wants ad-hoc personal skills with no pinning, those stay in a personal/global skills directory outside Intent.

### Canonical content hashing

**Resolved:** `contentHash` is an aggregate hash over normalized package-relative `SKILL.md` paths and raw file bytes, sorted by normalized path.

The hash input is a deterministic sequence of entries. Each entry contains:

- A normalized package-relative path to a `SKILL.md` file.
- The exact file bytes read by the scanner.

Path rules:

- Use `/` separators.
- Preserve case.
- Reject absolute paths.
- Reject `.` / `..` segments that escape the package root.
- Never include physical read locations such as `node_modules`, `.pnpm`, or `.yarn/cache/*.zip`.

The aggregate hash sorts entries by normalized path using ordinal string order. Duplicate canonical paths are invalid. Duplicate skill names are not part of the hash identity; manifest validation may still flag them separately.

Intent hashes exact bytes, including line endings. Package authors should publish consistent bytes. This favors supply-chain integrity over semantic normalization.

### Static discovery boundary

**Resolved:** Intent may execute package-manager resolution infrastructure, but must not execute discovered package code.

Static discovery means Intent reads package metadata and skill files as data. It does not mean "no project-local JavaScript ever runs." Yarn PnP requires loading package-manager resolution infrastructure such as `.pnp.cjs` / `pnpapi` to map package identities to readable package locations.

Allowed execution:

- The project's package-manager resolution API, used only to resolve package locators and readable package roots.

Forbidden execution:

- Package entrypoints (`main`, `exports`, or resolved module files).
- Package `bin` files.
- Lifecycle scripts (`preinstall`, `install`, `postinstall`, and related hooks).
- Framework config files or other package-provided JavaScript.
- Dynamic `import()` / `require()` of candidate packages.

Allowed reads after resolution:

- `package.json`.
- `skills/intent.manifest.json`.
- Files under `skills/`, including `SKILL.md`.

If package-manager resolution loading fails, Intent fails closed with a clear diagnostic. It must not fall back to importing candidate packages or running Node package resolution against package entrypoints.

### Transitive skill trust

**Resolved:** trust does not propagate transitively in v1.

An entry in `package.json#intent.skills[]` authorizes only the explicitly declared source. For npm package sources, listing `pkg-a` authorizes skills discovered in `pkg-a` itself. It does not authorize skills discovered in dependencies of `pkg-a`.

If `pkg-a` depends on `pkg-b` and `pkg-b` provides skills, `pkg-b` must also appear in `intent.skills[]` before Intent loads its skills. In M1, an unlisted transitive skill source emits an unlisted-source warning. In M2 frozen mode, it is a hard failure unless the package is explicitly listed or excluded.

Implementations may include diagnostic context that explains why an unlisted source was discovered, such as `pkg-a -> pkg-b`. That relationship does not imply trust.

## 3. Audit of prior design decisions to preserve (no regressions)

These were deliberately changed in earlier iterations. The v1 plan must not re-introduce them.

| Past decision                                                                                                                                            | Evidence in repo                                                                                                                                                                                                                                                          | Implication for v1                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Library packages do not ship bins.** Detection moved from `bin.intent` to `keywords: ["tanstack-intent"]`.                                             | `library-scanner.ts:isIntentPackage` comment: _"Legacy fallback: packages published before the keyword-based detection change may only have bin.intent. Keep this until a breaking release."_                                                                             | Don't propose any v1 feature that requires a library package to ship an executable (no per-library MCP server, no per-library `intent-library` bin, no per-library policy enforcer). Anything that needs runtime lives in `@tanstack/intent`.                                                                                               |
| **Consumer discovery today is over-permissive — `skills/` dir + derivable `intent` config is enough.** The keyword is _not_ a gate on the consumer side. | `scanner.ts:tryRegister` registers any installed package with a `skills/` directory and a `validateIntentField`-passable or `deriveIntentConfig`-derivable config. No keyword check. The keyword check exists only in the abandoned `library-scanner.ts:isIntentPackage`. | M1's explicit-sources list **replaces** today's permissive default. The keyword stays as a marker for registry indexing and as a sanity hint, but it does not authorize consumer trust. After M1, presence in `intent.skills[]` is the authorization.                                                                                       |
| **Discovery is static. Scanner never imports user package code.**                                                                                        | `scanner.ts` and `library-scanner.ts` use `readFileSync` + `createRequire().resolve(.../package.json)` only. No `await import(<userPkg>)`.                                                                                                                                | M1 codifies this with a code-comment invariant + ESLint `no-restricted-imports` rule scoped to `scanner.ts`, `manifest.ts`, `lockfile.ts`, and `mcp/`. Package-manager resolution infrastructure such as Yarn PnP is the only execution exception. Manifest generation in M3 and the MCP server in M5 must not load library code (see D12). |
| **Consumer-facing config lives in `package.json` (under `intent`), not in a separate config file.**                                                      | `scanner.ts:validateIntentField` reads `package.json#intent`. There is no `intent.config.json` in the repo.                                                                                                                                                               | Resolved: sources go in `package.json#intent.skills[]`. D2 closed.                                                                                                                                                                                                                                                                          |
| **`bin.intent-library` was a planned consumer path that was abandoned in favor of the keyword model.**                                                   | `intent-library` bin exists in `package.json`, plus `src/intent-library.ts` + `src/library-scanner.ts`. `scanLibrary(process.argv[1])` walks up from the bin's own script path — only meaningful inside a library's `node_modules`.                                       | Do **not** revive this in v1. See §4.                                                                                                                                                                                                                                                                                                       |
| **Consumers can already exclude/blacklist packages.** A subtractive filter exists independent of any allowlist.                                          | `core/excludes.ts`: `package.json#intent.exclude[]` (package-name globs, merged from cwd up to workspace root) + `--exclude <pattern>` flag on `list`/`load`. Glob support is `*`-only; exact names match exactly.                                                        | M1's allowlist (`intent.skills[]`) is **additive** (opt-in); `intent.exclude[]` stays **subtractive** and is applied _after_ the allowlist. Removing exclude would be a regression. v1 also extends exclude to match skill names, not just package names (see M1).                                                                          |

## 4. Cleanup item (blocks M1)

> ✅ **Completed on `main` (@ `0.0.43`, verified 2026-06-13).** The `intent-library` bin, `src/intent-library.ts`, `src/library-scanner.ts`, and `tests/library-scanner.test.ts` are removed; the `build` script no longer lists them; no `bin.intent` legacy fallback remains; `git grep` finds no residual references in shipped `src`/`package.json`. The remaining open item is the docs/examples/CI usage search below. The original scope is preserved for the audit trail.

Remove the vestiges of the abandoned library-bin model:

- `bin.intent-library` entry in `packages/intent/package.json` (and remove from `build` script's tsdown entry list).
- `packages/intent/src/intent-library.ts`.
- `packages/intent/src/library-scanner.ts`.
- Their tests (`tests/library-scanner.test.ts`).
- The `bin.intent` legacy fallback behavior from the abandoned library-scanner path.

**Resolved D1:** remove now. This is a breaking cleanup. Anyone invoking `intent-library` directly must migrate to the supported v1 discovery flow through the live scanner. No compatibility shim is provided because the old command no longer represents supported behavior.

Before implementation, search repository docs, examples, package metadata, and CI for `intent-library`, `library-scanner`, `bin.intent`, and `intent library`. If pre-release validation finds active public or internal usage, document the break explicitly in the migration guide rather than preserving a no-op command.

---

## 5. Milestones

Each milestone is independently shippable. The first four are sequential; M5, M6, and M7 can move in parallel once M3 lands. **M7 splits for v1:** Part B (staleness hardening) is a **maintainer-reliability commitment** that ships in 1.0 — it builds on the M2 lockfile and is prioritized alongside M3, ahead of M4/M5/M6. Part A (the maintainer agent surface) is the designated **cut candidate** — first to slip if the security core (M1–M4) runs hot, because it rides on the M5 MCP server and has no security surface of its own.

### M1 — Explicit skill sources + static-discovery invariant

**Goal:** Stop trusting every installed package with a `skills/` directory. Make the project's allowlist the sole gate.

- Read `package.json#intent.skills[]` as the project's allowlist (D2 closed).
- **Model sources as a discriminated union from day one** (`{ id, kind, ... }`), not a flat list of package-name strings. This is the same source-identity shape M2's lockfile stores (`id`, `kind`, `version`, optional `resolution`), so M1 builds it once instead of M2 refactoring it. Each entry in `intent.skills[]` parses into a typed `SkillSource`; an unrecognized prefix is a clear error, never a silent drop.
- Source kinds, v1:
  - `"@scope/pkg"` or `"pkg"` — `kind: npm`. An npm package, must be reachable via the project's dependency tree (direct or transitive).
  - `"workspace:@scope/pkg"` — `kind: workspace`. A package in the current workspace. Works for npm, pnpm, yarn, bun workspaces — the `workspace:` prefix is Intent-internal syntax, not a package-manager protocol.
  - `"git:<host>/<repo>#<ref>"` — `kind: git`. A standalone curated/personal skills repository pinned to a ref. **Reserved in M1, not implemented.** M1 parses and validates the shape but rejects it with a "not supported until the lockfile lands" diagnostic, because a git source cannot be trusted without M2's pin (see §2 _Standalone curated sources_, D19). Implementing materialization in M1 — before there is a lockfile to pin the resolved ref and content hash — would re-open the over-permissive trust hole this milestone closes.
- `scanForIntents()` filters discovered packages against the allowlist:
  - Listed + found → included.
  - Listed + not found → warning ("declared in intent.skills but not installed"). In M2 frozen mode this becomes a hard fail.
  - Not listed + found (has `skills/` dir) → warning ("found skills in <pkg> but not in intent.skills — add it to opt in"). In M2 frozen mode this becomes a hard fail.
- Trust does not propagate transitively. If a listed package depends on another package that provides skills, the dependency is still an unlisted source until it appears in `intent.skills[]`.
- **Exclude / blacklist is preserved and extended (regression guard — see §3).** The existing `package.json#intent.exclude[]` + `--exclude <pattern>` filter stays. Semantics in the allowlist world:
  - The allowlist (`intent.skills[]`) is **additive** (opt-in); `exclude[]` is **subtractive** and applied _after_ the allowlist resolves. A source can be admitted by the allowlist and then have specific skills suppressed.
  - v1 **extends exclude to skill-name granularity.** Today a pattern only matches a package name; v1 also matches a skill's `name` (e.g. `@scope/pkg`, `@scope/pkg#search-params`, or `*#experimental-*`), enabling exclusion of a single skill rather than a whole package. Backward compatible — bare package-name patterns keep working.
  - Excluded sources/skills never reach the lockfile, the diff, generated indexes, capability prompts, skill lookup, invocation, or the MCP server. An excluded-but-installed package does **not** trigger the "unlisted source" warning (exclude is an explicit decision, not an oversight).
  - **No dedicated `exclude` command in v1.** Excludes stay declarative — hand-edited in `package.json#intent.exclude[]` so they're reviewable in a PR like the allowlist. To keep that ergonomic, whenever `intent skills scan`/`diff` surfaces a discovered-but-unwanted source, it prints the exact line to paste (e.g. `to exclude: add "@scope/pkg#experimental-*" to intent.exclude[]`). The `--exclude <pattern>` flag still covers one-off runs. See §14.
- Hard invariant: never `await import()` user package code. Add a code-comment invariant and an ESLint `no-restricted-syntax` rule prohibiting dynamic `import()` of computed paths inside `scanner.ts`, `lockfile.ts`, `manifest.ts`, and `mcp/`.
- PnP compatibility exception: scanner code may load package-manager resolution infrastructure (`.pnp.cjs` / `pnpapi`) only to map package identities to readable package roots. It must not load package entrypoints, bins, lifecycle scripts, framework configs, or other package-provided JavaScript.
- The `tanstack-intent` keyword is no longer required for consumer discovery. Still recommended for registry indexing.

### M2 — Lockfile + approve / diff / update + frozen mode

**Goal:** Make discovery reproducible and changes reviewable.

New file `intent.lock` (committed at consumer project root). V1 uses a single committed root `intent.lock` as the authoritative approval state and policy snapshot. It does not create a `.intent/` directory or committed audit log. Normal VCS history and deterministic lockfile diffs are the v1 audit mechanism.

```jsonc
{
  "lockfileVersion": 1,
  "generatedAt": "2026-05-26T...",
  "intentVersion": "1.0.0",
  "staleness": {
    "baseline": {
      "kind": "tag",
      "ref": "v1.42.0",
      "commit": "abc123...",
    },
  },
  "sources": [
    {
      "id": "@tanstack/router",
      "kind": "npm",
      "version": "1.42.0",
      "resolution": "npm:@tanstack/router@1.42.0", // optional package-manager identity; never a cache path
      "manifestHash": "sha256-...", // null if package has no M3 manifest yet
      "contentHash": "sha256-...", // aggregate hash over normalized package-relative SKILL.md paths + exact bytes
      "capabilities": ["reads_project_files"],
      "declaredSecrets": [],
      "downloads": false,
      "installs": false,
      "mcpTools": [],
      "mcpPolicy": {},
    },
  ],
  "policy": {
    "ignores": [
      {
        "id": "skill-package-install-script",
        "scope": {
          "source": "@tanstack/router",
          "contentHash": "sha256-...",
        },
        "reason": "Accepted until upstream removes the install script.",
        "createdAt": "2026-05-26T...",
        "expiresAt": "2026-08-26",
      },
    ],
  },
}
```

`manifestHash` is nullable so M2 ships before M3 lands without an interlock. Once a package publishes an M3 manifest, its hash becomes part of the diff.

The lockfile does not store scanner read locations such as `node_modules/@scope/pkg`, `.pnpm/...`, or `.yarn/cache/*.zip/...`. The scanner may use those locations to read files during the current run, but lock comparison uses stable source identity plus package-relative paths.

`contentHash` uses the canonical hashing rules in §2. A package moved between `node_modules`, pnpm, Yarn PnP, and workspace sources must produce the same hash when its package-relative skill paths and bytes are identical.

New shared modules: `lockfile.ts` (read/write/parse), `hash.ts` (sha256 helpers). New commands:

- `intent skills scan` — discover + compute current state + diff against lock. Read-only. Safe in all modes.
- `intent skills approve [source]` — write/update lock entries. No arg → prompts per source. `--all` → accepts everything pending. Single source id → updates only that one. Refuses to run in frozen mode.
- `intent skills diff` — human-readable diff of pending changes (added/removed sources, version bumps, content/manifest/capability/MCP-tool changes). Read-only.
- `intent skills update [source]` — re-resolve to latest installed version and re-approve. No arg → all sources. Refuses to run in frozen mode.

**Frozen mode:**

- Triggered by `--frozen`, `INTENT_FROZEN=1`, or auto-detected when `CI=true` and stdin is not a TTY (overridable with `--no-frozen`).
- `scan` and `diff` still run — read-only and necessary to _detect_ drift.
- `approve` / `update` refuse to mutate `intent.lock`.
- Unlisted sources with `skills/` directories are a hard fail (M1 warning promoted).
- Lockfile mismatch (any pending diff) is a hard fail with non-zero exit and a one-screen summary.
- No outbound network: short-circuits `staleness.ts:fetchNpmVersion`.
- No arbitrary `execFileSync`/`execSync` against user-side tools (`gh`, package managers, project scripts, globally installed binaries, etc.). `feedback.ts:submitFeedback` is interactive-only and not invoked in CI today; the guard makes that explicit.
- Frozen mode exception: M7 may use an internal read-only Git adapter for local repository object inspection required by staleness checks. This adapter is not a general subprocess escape hatch.
  - It may resolve local baseline refs and read local tree/blob object IDs.
  - It must pass arguments as `argv`, never through a shell.
  - It must use a fixed allowlist of read-only operations such as `rev-parse --verify`, `cat-file`, and `ls-tree`, with constrained argument shapes.
  - It must not run `fetch`, `pull`, `push`, `checkout`, `switch`, `reset`, `merge`, `commit`, config mutation, hooks, package managers, credential prompts, or commands that contact remotes.
  - It must fail closed with a clear diagnostic if Git data cannot be read in frozen mode.

**First-run behavior (no lockfile present):**

- `intent skills scan` reports "no intent.lock — run `intent skills approve --all` to create one."
- `intent skills approve --all` writes the initial lockfile from currently-installed sources matching `intent.skills[]`.
- Frozen-mode commands refuse to run without a lockfile: "no intent.lock found; run interactively first."

**Touches:** new `lockfile.ts`, new `hash.ts`, new `commands/skills-{scan,approve,diff,update}.ts`, new `mode.ts` (frozen-mode detection), gate calls in `staleness.ts` + `feedback.ts` + `utils.ts:detectGlobalNodeModules`.

### M3 — Manifest schema + `intent skills generate-manifest` + extended `intent skills validate`

**Goal:** Give skill packages a stable, hashable surface separate from `SKILL.md` content, **and bring generated `SKILL.md` frontmatter into full Agent Skills–spec compliance** (D20). Authored by maintainers, consumed by the lockfile diff on the consumer side.

#### Agent Skills frontmatter compliance (D20)

**Resolved D20:** `SKILL.md` frontmatter must be compliant with the [Agent Skills specification](https://agentskills.io/specification). Intent-specific data moves off the top level; the manifest carries everything structured.

The spec allows exactly six top-level frontmatter keys: `name` (required), `description` (required), `license`, `compatibility`, `metadata`, and `allowed-tools`. `metadata` is a **string→string map only** — no arrays, no nested objects. Today Intent emits non-spec top-level keys (`type`, `library`, `library_version`, `framework`, `sources`), which IDE schema validation and external Agent Skills tooling reject (discussions #116, #140).

v1 resolution — **manifest-first, no backward-compat shim** (v1 is already a breaking release; these fields are Intent-internal and read only by Intent):

- **Scalar Intent fields move under `metadata` as strings.** `type`, `library`, `library_version`, `framework` become `metadata.type`, `metadata.library`, `metadata.library_version`, `metadata.framework`. `library_version` stays machine-readable there for staleness Layer 1.
- **Array / structured fields move to the manifest, not frontmatter.** `sources` and `requires` are not representable in a string-only `metadata` map, so they live in `skills/intent.manifest.json` (the manifest is Intent's structured surface and is not bound by the frontmatter spec). `requires` load-order hints also remain available via `package.json#intent.requires`.
- **No serialized-string duplication in `metadata`.** Arrays are not stuffed into `metadata` as delimited strings — that would be permanent cruft the content hash must keep tracking. The manifest is the single structured source.
- **Migration:** existing skills with non-spec top-level keys are migrated by `generate-manifest`/a `validate --fix` path — scalars rewritten under `metadata`, arrays lifted into the manifest. Documented in `docs/migration/v0-to-v1.md`.

New file per skill package: `skills/intent.manifest.json` (ships with the package). V1 uses this package-level manifest as the canonical manifest surface. Per-skill manifest files such as `intent.skill.json` are not part of v1 and are rejected to avoid split-brain metadata.

```jsonc
{
  "manifestVersion": 1,
  "package": "@tanstack/router",
  "packageVersion": "1.42.0",
  "skills": [
    {
      "name": "routing/file-based",
      "path": "skills/routing/file-based/SKILL.md",
      "contentHash": "sha256-...",
      "capabilities": ["reads_project_files", "writes_project_files"],
      "declaredSecrets": [],
      "downloads": false,
      "installs": false,
      "mcpTools": [
        {
          "name": "search_routes",
          "description": "Search the project's route tree",
          "inputSchema": {
            "type": "object",
            "properties": {
              "query": { "type": "string" },
            },
            "required": ["query"],
          },
        },
      ],
    },
  ],
}
```

- `intent skills generate-manifest` — walks `skills/`, computes content hashes, runs static heuristics (regex scan for `curl|wget`, `npm i|pnpm add|yarn add|bun add|pip install`, `SECRET_PATTERNS` from the shared `secrets.ts` module, fenced code blocks containing `child_process`/`spawn`/`exec`), and emits a manifest pre-filled with the heuristic findings. The maintainer reviews the diff and commits. Static analysis **informs** the manifest; the maintainer has final say on declared capabilities.
- `intent skills validate` (replaces today's flat `intent validate`):
  - All existing SKILL.md format/length/frontmatter checks.
  - **Agent Skills–spec frontmatter compliance (D20): error (not warning) on any non-spec top-level key.** Only `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` are allowed at the top level; `metadata` must be a string→string map. Non-spec keys (`type`, `library`, `library_version`, `framework`, `sources`, `requires`, …) fail validation with a remediation pointer ("move scalars under `metadata`; move arrays to the manifest"). `validate --fix` performs the migration.
  - Manifest exists, parses, every `SKILL.md` is listed, every listed path exists.
  - Stored `contentHash` matches actual content (catches missed regenerate).
  - Manifest entries are sorted by normalized package-relative `SKILL.md` path. Paths use `/`, are package-relative, and must not be absolute or contain `.` / `..` escapes.
  - Manifest generation is deterministic: stable entry order, stable object key order, and no generated timestamps.
  - Duplicate package-relative paths or duplicate stable ids fail validation.
  - Per-skill manifest files are rejected in v1.
  - `mcpTools[]` entries validate as MCP-compatible metadata: stable `name`, optional `description`, and optional JSON Schema-compatible `inputSchema`.
  - `mcpTools[]` entries must not contain runtime wiring fields such as `command`, `entrypoint`, `runtime`, `transport`, `server`, `package`, `module`, `env`, or `cwd`.
  - Static heuristics agree with declared capabilities. Disagreement → warning, not error. Hard error only if a literal secret value matches `SECRET_PATTERNS` in skill body — the maintainer can declare a secret _name_ (`GITHUB_TOKEN`) but never embed a value.
- `SECRET_PATTERNS` moves from `feedback.ts` into a new `secrets.ts` module so scanner, validator, manifest generator, and feedback share one source.
- **`generate-skill` meta-skill rewrite (D20):** its Step 3 frontmatter templates emit the spec-compliant shape — spec keys at top level, Intent scalars under `metadata`, no top-level `type`/`library`/`library_version`/`framework`/`sources`. Structured data is written to the manifest via `generate-manifest`, not the frontmatter.

**Touches:** new `manifest.ts`, new `secrets.ts` (move + add patterns), new `commands/skills-generate-manifest.ts`, refactor `commands/validate.ts` → `commands/skills-validate.ts` (add spec-key enforcement + `--fix`), `packages/intent/meta/generate-skill/SKILL.md` (compliant frontmatter templates), types.

### M4 — Capability/secret/download metadata wired through lockfile

**Goal:** Make approval and diff capability-aware.

- Capability deltas become first-class diff entries. A version bump that adds `uses_network` requires re-approval; a content-only change that doesn't shift capabilities still requires approval but is rendered as low-risk.
- Approval prompt copy (draft):

  ```
  @tanstack/router v1.42.0 → v1.43.0
    + adds capability: uses_network
    + adds MCP tool: search_routes (side-effecting)
    ~ content changed: 3 skills updated
  [y] approve   [n] reject   [d] full diff   [s] skip for now   [?] help
  ```

  - `skip` defers the decision (no lockfile change, no error in interactive mode; still a fail in frozen mode).
  - `reject` writes a scoped rejection entry into the lockfile. The rejection is bound to the observed source identity and canonical state: version when available, `contentHash`, `manifestHash`, and declared capability state. The diff suppresses the rejected source only while those fields still match.
  - Any source identity, version, content, manifest, or capability change re-surfaces a rejected source for review. Rejection is not represented as an unqualified boolean that suppresses a source indefinitely.
  - Rejection entries may include audit metadata such as `rejectedAt`, `rejectedBy`, and `reason`, but enforcement depends on the canonical observed state.

- Secrets remain names-only across the system — Intent records what a skill declares it needs, never the values.

**Touches:** extends `lockfile.ts`, `commands/skills-{approve,diff}.ts`. No major new files.

### M5 — MCP server

**Goal:** Expose the approved skill catalog over MCP so coding agents can query it without scraping files. Ship it alongside the security model so MCP behavior is gated by the lockfile from day one.

**Tool surface (v1) — all implemented inside `@tanstack/intent`. No tool implementations are loaded from library packages.**

> **Tool-shape rationale.** Maintainer trials found that a two-step `list_skills` → `get_skill` flow produces **worse** agent outcomes than a **single `get_skill(name)` tool whose description enumerates every approved skill** (name + one-line description). Putting the catalog directly in the tool description keeps it in the agent's context at decision time, instead of costing a discovery round-trip the agent often skips or fumbles. v1 adopts the single-tool shape as the default. `list_skills` and `search_skills` are overflow tools for large catalogs, not the preferred path.

**Primary tool (default):**

- `get_skill(name)` — returns the full `SKILL.md` body for one approved skill. **Its description is generated at server start from the approved lockfile** and embeds the catalog when the catalog fits within configured size limits: each approved skill's `name` + one-line description + capabilities summary. The agent picks a `name` directly from the description; no separate discovery call. The description is rebuilt whenever the lockfile is reloaded (start / SIGHUP).

**Catalog-scaling fallback tools (overflow path):**

- `list_skills` — compact skill index (name, package, description, capabilities summary). Registered only when the catalog exceeds configured size limits, so small/medium projects keep the single-tool path.
- `search_skills(query)` — text search across the approved skill index. Same threshold gating; valuable for large monorepos where embedding the whole catalog in a description is impractical.

**Resolved catalog threshold behavior:** `get_skill` always exists when the lockfile is valid. Below threshold, its description embeds the full approved consumer catalog. Above threshold, `get_skill` remains available, its description contains a bounded compact summary plus guidance to call `list_skills` / `search_skills`, and those fallback tools are registered. Fallback tools augment `get_skill`; they do not replace it.

The fallback threshold is triggered when either:

- The approved consumer catalog exceeds the configured skill-count limit.
- The rendered `get_skill` description would exceed the configured token budget.

Token budget is the primary guard because a small number of verbose skills can still exceed client limits. Embedded catalog entries stay compact: skill name, one-line description, and capability summary only.

**Verification tools (always available):**

- `get_lock` — current `intent.lock` (lets an agent verify its view).
- `get_diff` — current pending diff between lockfile and installed state.

Skill-declared `mcpTools[]` (in manifest) is **metadata only** in v1. It describes tools the skill _says_ its library exposes elsewhere. Intent records this metadata in the lockfile, requires explicit policy entries before surfacing it as approved metadata, and surfaces it via the `get_skill` description / `list_skills`, but does **not** wire runtime for it — that would require importing library code and breaks the static-discovery invariant.

V1 `mcpTools[]` metadata is intentionally small:

- `name` — stable tool name within the declaring skill.
- `description` — optional human-readable summary.
- `inputSchema` — optional JSON Schema-compatible input metadata for review/display only.

`mcpTools[]` policy identity is fully scoped by source, skill path/name, and tool name. Bare tool names are not globally unique.

Runtime implementation fields are invalid in v1. Intent must not use `mcpTools[]` to start, import, resolve, install, spawn, connect to, or configure MCP tool implementations. Future skill-supplied MCP runtime support requires a new manifest version or separate field after the sandbox/runtime trust model is designed.

`exclude[]` (M1) applies before the MCP catalog is built — excluded skills never appear in the `get_skill` description, `list_skills`, or `search_skills` results.

Policy entries in `intent.lock`:

```jsonc
"mcpPolicy": {
  "@tanstack/router#skills/routing/file-based/SKILL.md:search_routes": "allow",
  "@tanstack/router#skills/routing/file-based/SKILL.md:delete_route": "deny"
}
```

`allow` means the agent is told this tool metadata exists and is approved for surfacing; `deny` hides it. Neither value allows Intent to execute the tool. V1 supports only `allow` and `deny`; `prompt` and other unknown policy values are invalid and fail closed. Lock mismatch restrictions are absolute and cannot be overridden by policy.

**Implementation:**

- Lives in `packages/intent/src/mcp/` (server + tool definitions). Subcommand `intent mcp serve`.
- Transport: stdio only in v1 (D6 closed — matches Claude Code, Cursor, Copilot CLI defaults).
- Always runs in frozen mode. Lockfile mismatch → server starts in degraded diagnostic mode:
  - Only `get_lock` and `get_diff` remain callable.
  - `get_skill`, `list_skills`, and `search_skills` return a structured `LOCKFILE_MISMATCH` error pointing at `get_diff` and `get_lock`.
  - `get_diff` may report changed sources, versions, paths, hashes, capabilities, statuses, and reason codes, but must not return full drifted `SKILL.md` content.
  - Missing or malformed lockfiles use the same degraded diagnostic mode.
  - Degraded diagnostic mode is read-only: no lockfile writes, cache writes, index refreshes, skill-file writes, or workspace mutations.
- Author mode exception: `intent mcp serve --author` may start without a consumer `intent.lock`, but only to expose bundled first-party meta-skills from the running `@tanstack/intent` package. Consumer, workspace, file, registry, linked, or discovered skills remain unavailable until approved in `intent.lock`.
- Local install requirement: `intent mcp serve` must be resolved from the current project/workspace dependency graph and represented in the package-manager lockfile. If invoked from `npx`, `dlx`, a global install, or another ephemeral package execution environment, it fails with an actionable error explaining that MCP serving requires a local install. Exact-version `npx @tanstack/intent@<version>` remains supported for one-off `list` and `install`, not for MCP serving.
- New dependency: `@modelcontextprotocol/sdk` (eval first; if too heavy, write a minimal stdio JSON-RPC handler).

**Touches:** new `mcp/server.ts`, new `mcp/tools/*.ts`, new `commands/mcp-serve.ts`, types.

### M6 — `intent security doctor`

**Goal:** One command that surfaces the boring-but-important risks in a project. Read-only, safe to run anywhere.

Checks (each emits a categorized issue: `error`, `warning`, `info`):

- `intent.lock` exists where `package.json#intent.skills[]` is declared. (error)
- Every listed source resolves. (error)
- Lockfile has no pending diff. (warning — `error` if `--frozen`.)
- No version conflicts among installed skill packages (reuses existing `VersionConflict` from `scanner.ts`). (warning)
- No skill package has `scripts.postinstall|preinstall|install` (warning — the script may run before user approval).
- No skill content matches `SECRET_PATTERNS` (defense-in-depth; M3 catches this at publish time, doctor re-checks installed content). (error)
- Every entry in `mcpTools[]` has an explicit `mcpPolicy` (no implicit allow-by-omission). (warning)
- In maintainer projects (`@tanstack/intent` in `devDependencies`): the dependency uses an exact version, not a range. (info)
- In consumer projects with a lockfile: `@tanstack/intent` is also in `devDependencies` (warns against `npx`-only lock-driven workflows). (warning)

Exit code: non-zero if any `error`-level issue is present.

Security-doctor suppressions live in the top-level `intent.lock#policy.ignores[]` section. Lock entries describe observed source state; `policy.ignores[]` describes human risk acceptance. V1 does not allow inline policy fields inside source identity/hash entries.

Each ignore entry requires:

- `id` — stable security-doctor issue id or fingerprint.
- `scope` — the source, package, file, observed hash, or finding scope the ignore applies to.
- `reason` — human-readable justification.
- `createdAt` — ISO timestamp for audit.

Each ignore entry should include `expiresAt`. If `expiresAt` is missing, `intent security doctor` still suppresses the matching finding but reports the non-expiring ignore in a suppressed/ignored summary. Expired ignores do not suppress findings.

Ignores suppress only findings whose `id` and `scope` match. When the observed source identity, content hash, manifest hash, or capability state changes, the finding re-surfaces unless the ignore explicitly covers the new state.

**Touches:** new `commands/security-doctor.ts`. No new shared modules.

### M7 — Maintainer agent surface + staleness hardening

**Goal:** Maintainers invoke Intent's authoring workflows by _talking to their agent_ (`/tanstack-intent scaffold`, "update skills PR <#123>"), with hardened, security-aware staleness detection underneath. The CLI keeps working unchanged.

This milestone has two parts. They share one substrate (the meta-skills, the lockfile baseline) and must stay consistent, but for v1 they have **different release commitments**:

- **Part B — staleness hardening: a 1.0 maintainer-reliability commitment.** Stale-skill detection is the reliability promise the whole project rests on — a maintainer who can't tell their skills have drifted is the failure this exists to prevent. Part B builds only on the M2 lockfile (Layer 0 `contentHash`, Layer 2 baseline ref) and ships in 1.0, prioritized alongside M3 and ahead of M4/M5/M6.
- **Part A — maintainer agent surface: the cut candidate.** Part A rides on the M5 MCP server (it exposes meta-skills as MCP tools) and has no security surface of its own, so it is first to slip. If M5 runs hot, Part A fast-follows after 1.0. The CLI authoring flow (`scaffold`, `skills validate`, `skills generate-manifest`, `skills stale`, `skills update`) keeps working unchanged without it.

**Resolved D18 (revised):** Part B ships in v1 as a maintainer-reliability commitment; Part A is the minimal cut candidate.

Part A ships in v1 only if M1–M5 work is complete and verified without schedule risk. If it runs hot, Part A moves wholesale to fast-follow rather than shipping partially — the planned safety valve, not a failed v1. **Part B does not slip with it:** the layered staleness detector and `intent skills stale`/`update` surface are part of the 1.0 maintainer-reliability gate.

M7's v1 scope is gated:

- Bundled meta-skill author mode only.
- Local Layer 0–2 staleness only.
- Read-only Git adapter only.
- No network access.
- No remote baseline fetch.
- No non-bundled author-mode skills.
- No maintainer automation beyond the defined author-mode and staleness surface.

If Part A expands beyond those gates, it moves to fast-follow automatically. Part B (local Layer 0–2 staleness, read-only and no-network) stays in 1.0 within these gates.

#### Part A — Maintainer agent surface

Intent already ships five meta-skills (`packages/intent/meta/{domain-discovery,tree-generator,generate-skill,feedback-collection,skill-staleness-check}/SKILL.md`) and reaches them today via two CLI commands (`intent scaffold` prints an orchestration prompt; `intent meta [name]` lists/prints one). The agent-pluggable invocation surface is what's missing. M7 closes that without introducing a separate maintainer package or a new distribution channel.

- **Auto-detected author mode.** The MCP server (M5) treats a project containing `skills/` as a maintainer context and exposes bundled meta-skills as first-party tools. Projects without `skills/` get consumer mode only unless `--author` is passed. No flag required for the common maintainer case.
- **Explicit override.** `intent mcp serve --author` forces author mode and covers pre-scaffold, where `skills/` and `intent.lock` may not exist yet. In lockless author mode, the server exposes only bundled first-party meta-skills.
- **First-party trust.** Meta-skills bypass `intent.skills[]` allowlist gating because they ship inside `@tanstack/intent` itself — the one source the maintainer is already running code from. They are _not_ added to `intent.lock`. This is principled, not a hack: the trust model says "approve sources you don't already trust," and Intent trusts itself.
- **Catalog split.** Author mode builds a `metaCatalog` from bundled `@tanstack/intent` resources and a separate `consumerCatalog` from lock-approved project skills. The `metaCatalog` may be served without a consumer lockfile. The `consumerCatalog` is unavailable until `intent.lock` approves its entries.
- **Non-shadowable meta identities.** Bundled meta-skills use internal source identities such as `builtin:@tanstack/intent`. Workspace files, project dependencies, generated files, symlinks, linked packages, and registry packages cannot impersonate or override these identities.
- **Visible mode.** Startup diagnostics state author mode and lockfile status, for example: `Author mode: serving bundled @tanstack/intent meta-skills only; consumer skills disabled until intent.lock exists.`
- **CLI unchanged.** `intent scaffold` and `intent meta` keep working; `scaffold.ts`'s printed prompt collapses to a single pointer at the orchestration meta-skill, which becomes the **single source of truth** for the authoring flow (no prompt-vs-skill drift).
- **Consumer-side isolation.** Meta-skills already live in `meta/` (not `skills/`) with `category: meta-tooling` in frontmatter — the separation exists. M7 codifies it: the consumer-side scanner never walks `meta/`, and the MCP server never exposes `category: meta-tooling` skills in consumer mode even if encountered.

#### Part B — Staleness hardening (layered, security-aware)

Today's `staleness.ts` does version-drift + artifact-drift well, but punts content-staleness to an external `sync-skills.mjs` (TanStack-internal, uses webhooks + GitHub API + a separate `sync-state.json`). That's both fragile for general library maintainers and a bag of security concerns. M7 generalizes detection into a layered model fed by the **committed lockfile**, not a parallel state file or the network.

**Principle:** _staleness is a signal, not a gate._ The security boundary is M2 (lockfile mismatch refusal) + M4 (capability/manifest enforcement). Staleness only decides "should a maintainer re-review." This means staleness can be imperfect without being insecure — and over-precision buys fewer false PRs, not more security. Don't conflate the two.

**Layered detector** (cheapest → most precise; an upper layer always feeds candidates to the layer above, never delivers a hard verdict):

- **Layer 0 — Skill self-integrity (new).** SKILL.md `contentHash` is already recorded in `intent.lock` (M2). M7 surfaces a mismatch as a "skill modified since approval" staleness signal on the maintainer side, in addition to M2's serving-time refusal on the consumer side. Bidirectional integrity from one hash.
- **Layer 1 — Version constraint (existing, downgraded).** `classifyVersionDrift()` already classifies major/minor/patch drift between skill `library_version` and current package version. **Patch is a low-signal hint, not "ignore"** — CVE fixes ship as patch versions, so dismissing patch drift hides security-relevant updates. Already implemented; only the policy changes.
- **Layer 2 — Source SHA against the lockfile baseline.** Replace the current `skills/sync-state.json` `sources_sha` (remote GitHub SHAs) with **git blob SHAs against a baseline ref recorded in `intent.lock`**. Source touched since baseline → candidate fed to the agent for impact classification; never a hard "stale" verdict on its own. This sidesteps byte-noise (whitespace/comment changes don't false-fail because the agent's classification step decides), and it makes the comparison **fully local** — no `registry.npmjs.org`, no GitHub API, no webhook. `sync-state.json` is removed; `intent.lock` is the single baseline.
- **Layer 3 — Semantic anchors (future, out of v1).** Couple skills to API symbols and detect symbol-level change. Highest precision; tracked in §14.

**Methods considered (with the security lens):**

| Method                                           | Why considered     | Why not (alone)                                                                                                                                                                                                     |
| ------------------------------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Constraint-only (uv-style)                       | Lowest noise       | **Unsafe alone** — CVE-bearing patches and within-version behavior changes slide past. Used only as Layer 1.                                                                                                        |
| Local self-managed content hash                  | Self-contained     | Over-sensitive (byte-noise) → alert fatigue is itself a security failure (real signal hides in the noise); duplicates state already in `intent.lock`.                                                               |
| Git blob SHA vs `HEAD~1`                         | Free, precise      | "Changed since last commit" is the wrong question — security-meaningful comparison is **vs the release the skill documents**. Layer 2 uses git blob SHA but against a lockfile-recorded baseline ref, not `HEAD~1`. |
| Webhook-driven (current `sync-skills.mjs` model) | Cross-repo updates | Webhook payload is attacker-influenceable — forged webhooks can trigger false update PRs or suppress real ones. Out of v1 (§14); pull-based local detection is the trustworthy default.                             |
| Semantic anchors (Swimm-style)                   | Highest precision  | Detector complexity = more attack surface in the detector itself. Layer 3, future.                                                                                                                                  |

**`skill-staleness-check` meta-skill rewrite.** Today the meta-skill calls `node scripts/sync-skills.mjs <library>` (a TanStack-internal script not shipped in the package) and reasons about webhook payloads. M7 rewrites it to call `intent skills stale` (the shipped CLI, which performs Layers 0–2 locally) and reason about the candidate set it returns. Step 2 ("classify impact: no-impact / version-bump / content-update / breaking") stays — that's where the agent's judgement lives. Step 6 (open PR) stays. Steps that assume webhook/cross-repo context are removed.

**New surface in `intent skills stale`:**

- Default: Layer 0 + Layer 1 + Layer 2 against the lockfile baseline. Local-only.
- `--baseline <ref>` to override the baseline ref.
- Baseline resolution order:
  1. `--baseline <ref>` when supplied.
  2. The baseline recorded in `intent.lock`, when present.
  3. The nearest reachable local tag from the read-only Git adapter.
- No implicit `HEAD~1` fallback. Users may pass `--baseline HEAD~1` explicitly if that is the intended comparison.
- If no baseline can be resolved in interactive mode, Layer 2 is reported as `unknown`/skipped with remediation guidance. If no baseline can be resolved in frozen mode, the command fails closed with a distinct diagnostic.
- `--files <path...>` escape hatch for CI to pass an explicit changed-file set (optimization; same Layer 2 classification, narrower input).
- Output: candidate skills + per-skill reasons (which layer fired). Exit non-zero if any candidate exists in `--frozen` mode (so CI gates a PR that hasn't refreshed staleness).

**Frozen-mode and network discipline.** `intent skills stale` makes **no network calls** in any mode. The `staleness.ts:fetchNpmVersion` path (already gated in frozen mode by M2) is removed from the staleness signal entirely — Layer 1 reads `package.json` only. This makes staleness reproducible (audit-friendly) and removes a TLS/DNS/registry-compromise vector.

In frozen mode, Layer 2 may use only the read-only Git adapter described in M2. If Git is unavailable, the project is not a Git repo, or the baseline ref cannot be resolved from local data, `intent skills stale --frozen` fails with a distinct diagnostic. It must not silently skip Layer 2 or fetch missing refs. Diagnostics say "no local reachable tag found" or "baseline ref is not available locally" rather than claiming the repository has no tags.

**Touches:** `staleness.ts` (drop `fetchNpmVersion`, add lockfile-baseline Layer 2, expose Layer 0 from existing lockfile hash), `commands/stale.ts` (new flags + non-zero exit in frozen), `commands/mcp-serve.ts` (author-mode detection + first-party meta-skill exposure), `commands/scaffold.ts` (collapse to pointer at orchestration meta-skill), `packages/intent/meta/skill-staleness-check/SKILL.md` (rewrite around `intent skills stale`), new tests in `tests/staleness.test.ts` + `tests/mcp-author-mode.test.ts`. Removes: `skills/sync-state.json` reads, references to `sync-skills.mjs` in shipped meta-skills.

**Migration:** existing `sync-state.json` files are ignored (not read, not deleted by Intent). TanStack's internal cross-repo workflow can keep its own `sync-skills.mjs` outside the published package — it's no longer wired into the shipped meta-skill.

## 6. CLI grouping

One bin (`intent`), nested verbs. Used by maintainers (from devDep) and consumers (from devDep, or `npx` for non-lockfile commands).

**Resolved D7:** v1 uses nested command groups as the canonical CLI shape. Domain-specific actions live under stable noun namespaces (`skills`, `mcp`, `security`). Top-level commands are reserved for established primary workflows or cross-domain actions.

**Maintainer-facing:**

```
intent scaffold
intent skills validate
intent skills generate-manifest
intent skills stale
intent edit-package-json
intent setup-github-actions
```

**Consumer-facing:**

```
intent list                       # discovery only, no lockfile required
intent install                    # create/update managed agent guidance; no lockfile required
intent skills scan
intent skills approve [source]
intent skills diff
intent skills update [source]
intent mcp serve
intent security doctor
```

There is no separate consumer bin. Library packages never ship a CLI.

**Naming notes:**

- `intent skills validate` and `intent skills stale` move under `skills` from the current flat `intent validate` / `intent stale`. Flat aliases stay for one release with a deprecation notice.
- **Resolved D14:** `intent install` keeps its name for v1 as an established flat first-run workflow, but docs/help describe it as creating or updating managed agent guidance. The command must make its write behavior explicit through flags/help text and must preserve content outside the managed block.
- Generated guidance commands are configurable so teams can control command/version policy without reimplementing `AGENTS.md` block insertion. Defaults keep the detected package-manager invocation for `@tanstack/intent`.
- Minimal v1 command-template surface:
  - `list` command template, e.g. `yarn ourcoollibrary list`.
  - `load` command template, e.g. `yarn ourcoollibrary load <use>`.
  - `load` templates must include `<use>`.
  - Custom command strings are treated as opaque guidance text. Intent does not parse or execute them.
- Configuration can come from explicit CLI flags and/or project config. If multiple discovered packages suggest conflicting guidance commands, Intent requires an explicit project/CLI override rather than choosing silently.
- `intent setup` is not chosen because it still implies mutation. `intent agent-prompt` is clearer but weaker as a primary onboarding command. A future rename needs a migration plan, alias period, and deprecation warning.
- `intent meta` (listing meta-skills) keeps its current behavior; orthogonal to the skill-discovery surface.
- V1 does not introduce flat aliases such as `intent scan`, `intent approve`, `intent diff`, `intent update`, `intent serve-mcp`, or `intent doctor`. Unknown flat commands should fail with a helpful suggestion to the canonical nested command when there is an unambiguous mapping.
- Help output groups commands by domain: Core, Skills, MCP, Security, Maintainer.
- Nesting stays shallow: no more than two levels after `intent`.

## 7. Consumer first-run walkthrough (target experience after M5)

```
# new project that wants AI agent skills
pnpm add -D @tanstack/intent
echo '{ "intent": { "skills": ["@tanstack/router", "@tanstack/query"] } }' \
  >> package.json   # (manually merged in reality)

pnpm exec intent skills scan
# → no intent.lock; 2 sources discovered; run `intent skills approve --all` to create one.

pnpm exec intent skills approve --all
# → prompts per source, writes intent.lock, commits alongside package.json

# add to .mcp config (or equivalent)
{ "mcpServers": { "intent": { "command": "pnpm", "args": ["exec", "intent", "mcp", "serve"] } } }

# CI
pnpm exec intent skills scan --frozen   # fails if drift or unlisted skills
pnpm exec intent security doctor        # warns on weak hygiene
```

## 8. Workspace skills handling

Skills sourced via `workspace:@scope/pkg` are first-party to the project and follow the same lockfile lifecycle as npm sources — they show up in `intent.lock`, require approval, are diffed on change. Content/manifest hashing catches drift across workspace package updates the same way it does for external packages. There is no "trust workspace blindly" shortcut in v1, because workspace authors and project authors aren't always the same person in larger monorepos.

Standalone curated sources (`kind: git`, reserved — §2 _Standalone curated sources_, D19) follow this same lifecycle when implemented post-M2: pinned ref identity, content hash, approval, and diff, with no trust shortcut. They are materialized into a gitignored managed directory but identified by the pinned ref, never the materialized path. M1 reserves the kind and rejects it; the build waits for the lockfile pin from M2.

**Resolved D9:** v1 approvals are source/package-scoped, not per-skill.

A source listed in `intent.skills[]` may be approved or rejected as a unit based on its manifest, content hash, and capability deltas. Individual skills cannot be independently approved in v1. Users may exclude individual skills from an approved source; exclusion suppresses discovery, catalog publication, MCP exposure, capability selection, generated indexes, skill lookup, and invocation, but it is not a separate trust decision.

Per-skill approvals are deferred until there is demonstrated demand. The schema should leave room for future per-skill policy layered under source approval, but v1 does not accept per-skill approval fields.

## 9. Versioning summary

| Artifact                      | Field                                | Source of truth | Bump policy                                                                                           |
| ----------------------------- | ------------------------------------ | --------------- | ----------------------------------------------------------------------------------------------------- |
| `intent.lock`                 | `lockfileVersion`                    | M2              | Bumped on incompatible shape change; reader rejects unknown majors.                                   |
| `skills/intent.manifest.json` | `manifestVersion`                    | M3              | Bumped on incompatible shape change; older consumers warn and fall back to content-hash-only diffing. |
| `@tanstack/intent` CLI        | `intentVersion` recorded in lockfile | M2              | Informational; security doctor warns on >1 minor behind.                                              |
| MCP tool schema               | implicit via tool name + arg shape   | M5              | Breaking changes require a new tool name.                                                             |

**Resolved D10:** v1 does not publish a separate `@tanstack/intent-types` package.

Public v1 type contracts for lockfiles, manifests, MCP metadata, capabilities, policies, source identity, and related schemas are exported from `@tanstack/intent`. Consumers should import types only from public exports, for example:

```ts
import type { IntentLockfile, IntentManifest } from '@tanstack/intent'
```

Deep imports from internal files are not supported. A separate type-only package remains a future option if integration authors show concrete need for a lightweight dependency without the CLI/runtime package. Track demand after v1, including install-size concerns, runtime dependency concerns, concrete consumers, and versioning expectations.

## 10. Testing strategy

- **M1:** unit tests in `tests/scanner.test.ts` covering the allowlist matrix (listed/found, listed/missing, unlisted/found, workspace/npm kinds, transitive skill package not trusted unless listed). Exclusion tests assert suppressed skills are unavailable for discovery, generated indexes, MCP exposure, skill lookup, capability prompts, and invocation. Integration test confirming a fresh project with no `intent.skills[]` emits the migration warning exactly once.
- **M2:** fixture-driven lockfile round-trip tests (parse → write → parse byte-identical). Tests assert commands write only root `intent.lock`, do not create `.intent/`, preserve top-level policy/rejection/staleness sections, and produce deterministic ordering across regenerations. Frozen-mode integration tests assert non-zero exit on each drift category. First-run test: no lockfile → `scan` reports missing, `approve --all` creates it.
- **M3:** manifest schema validation tests. `generate-manifest` golden-file tests over representative SKILL.md fixtures assert deterministic ordering/formatting, stable output across repeated runs, invalid path rejection, duplicate path/id rejection, missing/extra `SKILL.md` detection, per-skill manifest rejection, MCP-compatible `mcpTools[]` metadata validation, runtime-field rejection, and move/rename behavior. Round-trip with `scan` (manifest → lockfile manifestHash). **D20 spec-compliance tests:** `validate` errors on each non-spec top-level key (`type`, `library`, `library_version`, `framework`, `sources`, `requires`), accepts the six spec keys, rejects non-string `metadata` values; `validate --fix` migrates a non-compliant fixture to scalars-under-`metadata` + arrays-in-manifest; `generate-skill` output validates clean against the spec.
- **M4:** diff-rendering snapshot tests for each capability/MCP/version-change category. Rejection tests assert the same source identity + same observed hashes stays suppressed, while source identity, version, content, manifest, or capability changes re-surface a previously rejected source.
- **M5:** MCP server tested via the SDK's in-memory transport — `list_skills`, `get_skill`, `get_diff` over fixture lockfiles, including the lockfile-mismatch error path. Tool-shape tests assert small catalogs expose `get_skill` with the full embedded catalog, large or verbose catalogs expose `get_skill` with a compact summary plus `list_skills` / `search_skills`, and fallback tools augment rather than replace `get_skill`. Launch-path tests assert local project/workspace installs can serve MCP, while `npx`/`dlx`/global/ephemeral invocations fail for `mcp serve` but remain allowed for one-off `list`/`install`. `mcpTools[]` tests assert metadata is surfaced only after policy approval, tool identities are fully scoped, duplicate bare names do not collide, `prompt` and unknown policy values fail closed, and no imports, subprocesses, or MCP connections occur. Lock mismatch tests assert `get_lock`/`get_diff` remain callable while skill-serving/catalog tools fail. Author-mode tests assert `--author` without `intent.lock` serves only bundled meta-skills, does not serve workspace/consumer skills, and cannot be shadowed by local files.
- **M6:** doctor tests assert correct issue classification (error/warning/info) for each check. Ignore-policy tests assert matching `policy.ignores[]` entries suppress only matching issue/scope pairs, changed source hashes re-surface findings, expired ignores do not suppress findings, non-expiring ignores appear in the suppressed summary, and inline ignore markers in source entries are rejected.
- **M7:** staleness tests assert baseline resolution order (`--baseline`, lockfile baseline, nearest local tag), no implicit `HEAD~1` fallback, interactive `unknown` Layer 2 when no baseline resolves, frozen fail-closed diagnostics, no remote fetches, and explicit `--baseline HEAD~1` support.
- **CLI contract:** help/routing tests assert canonical nested commands are listed and route correctly; unsupported flat commands fail with suggestions to nested equivalents.
- **Type exports:** consumer fixture tests assert public type-only imports from `@tanstack/intent` compile for lockfile, manifest, MCP metadata, capabilities, policy, and source identity types under supported TypeScript module-resolution modes. Tests should not rely on deep imports or CLI/runtime side effects.
- **Install guidance:** tests assert default guidance uses the detected default command, custom `list`/`load` templates update every generated command, `load` templates without `<use>` are rejected, custom command strings are treated as opaque guidance text, dry-run/print mode does not modify files, write mode creates or replaces only the managed block, reruns are idempotent, content outside markers is preserved, and conflicting discovered command templates require explicit override.

Existing test commands (`test:lib`, `test:integration`, `test:smoke`) absorb the new tests without new infrastructure.

## 11. Performance notes

- Content hashing across a large monorepo's `node_modules` (hundreds of skill files) is the main cost. Mitigations: hash incrementally per-file, cache by file mtime+size in `.intent/cache.json` (gitignored), short-circuit when both manifest and lockfile entry already exist with matching `manifestHash`.
- The MCP server loads the lockfile once at start and only re-reads on SIGHUP (or file watcher in a follow-up).
- No mitigations needed in v1 for projects under ~50 sources; revisit if profiling shows otherwise.

## 12. Docs work (per milestone)

- **Cleanup + M1:** README + `docs/overview.md` + `docs/registry.md` updated for devDep-first install. New `docs/security/trust-model.md` (explicit sources + static-discovery invariant). Migration guide `docs/migration/v0-to-v1.md`.
- **M2:** `docs/security/lockfile.md`, `docs/cli/intent-skills.md` (scan/approve/diff/update). Frozen-mode reference.
- **M3:** `docs/security/manifest.md`, `docs/cli/intent-skills-validate.md`, `docs/cli/intent-skills-generate-manifest.md`. Document Agent Skills frontmatter compliance (D20): the six allowed top-level keys, Intent scalars under `metadata`, arrays in the manifest, and the `validate --fix` migration. The `v0-to-v1` migration guide covers moving existing non-spec frontmatter.
- **M5:** `docs/mcp/overview.md`, `docs/mcp/policy.md`, `docs/cli/intent-mcp-serve.md`.
- **M6:** `docs/cli/intent-security-doctor.md`, troubleshooting page.
- **Install guidance:** `docs/cli/intent-install.md` documents managed-block behavior, non-managed surrounding content preservation, dry-run/print/write modes, configurable `list`/`load` command templates, `<use>` placeholder validation, and wrapper/pinned-version examples.
- **Type exports:** docs show public type-only imports from `@tanstack/intent` and note that v1 does not publish `@tanstack/intent-types`.
- `CONTRIBUTING.md` gets a "decisions to preserve" pointer to §3 so contributors don't unwittingly regress.

**Token efficiency (cross-cutting):**

- Lockfile + manifest are full-fidelity (verification).
- Compact skill index for agent selection is **derived** from the manifest on the consumer side (built by `intent skills scan`, cached in `.intent/cache.json`). One source of truth, no separate shipped artifact.
- Index payload per skill: name + description + capabilities-summary + path. No body text.
- `SKILL.md` body is lazy-loaded only when an agent calls `get_skill(name)` or reads the path directly.

---

## 13. Decisions — consolidated

All RFC decisions are resolved. Detailed rationale lives in the milestone sections above.

| ID  | Question                                                                  | Resolution                                                                                                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Remove `intent-library` bin+sources now vs deprecate                      | Remove now as a v1 breaking cleanup. No compatibility shim.                                                                                                                                                                                                                                                             |
| D2  | Sources in `package.json#intent.skills` vs `intent.config.json`?          | Use `package.json#intent.skills[]`.                                                                                                                                                                                                                                                                                     |
| D3  | Drop `bin.intent` legacy fallback in `isIntentPackage`?                   | Yes. Removed with the abandoned `library-scanner.ts` path.                                                                                                                                                                                                                                                              |
| D4  | Single `intent.lock` vs `.intent/` folder                                 | Single committed root `intent.lock`. VCS history and deterministic diffs are the audit mechanism.                                                                                                                                                                                                                       |
| D5  | Package-level vs per-skill manifest                                       | Package-level `skills/intent.manifest.json`. Per-skill manifests are rejected in v1.                                                                                                                                                                                                                                    |
| D6  | MCP transport: stdio only vs stdio + HTTP/SSE                             | Stdio only in v1.                                                                                                                                                                                                                                                                                                       |
| D7  | Flat vs nested CLI verbs                                                  | Nested domain commands are canonical. No new flat aliases.                                                                                                                                                                                                                                                              |
| D8  | What does an unlisted source do in M1?                                    | Warn in M1. Hard fail in M2 frozen mode.                                                                                                                                                                                                                                                                                |
| D9  | Per-skill approvals                                                       | Out of v1. Approvals are source/package-scoped; individual skills can be excluded.                                                                                                                                                                                                                                      |
| D10 | Publish `@tanstack/intent-types`                                          | Not in v1. Public types are exported from `@tanstack/intent`.                                                                                                                                                                                                                                                           |
| D11 | `intent mcp serve` via `npx` vs local dependency                          | Local project/workspace install only. `npx` remains for one-off `list` / `install`.                                                                                                                                                                                                                                     |
| D12 | `mcpTools[]` metadata vs runtime implementation shape                     | Metadata only in v1. Runtime fields are invalid; future runtime support needs a new versioned shape.                                                                                                                                                                                                                    |
| D13 | Interactive `prompt` MCP policy                                           | Out of v1. Valid policy values are `allow` and `deny`; `prompt` and unknown values fail closed.                                                                                                                                                                                                                         |
| D14 | Rename `intent install`                                                   | Keep the name in v1. Add configurable guidance commands for managed agent guidance.                                                                                                                                                                                                                                     |
| D15 | MCP tool shape and fallback threshold                                     | `get_skill` is primary. Embed full catalog below threshold; above threshold use compact summary plus `list_skills` / `search_skills`.                                                                                                                                                                                   |
| D17 | Default baseline ref for Layer 2 staleness                                | `--baseline`, then lockfile baseline, then nearest local tag. No implicit `HEAD~1` fallback.                                                                                                                                                                                                                            |
| D18 | M7 in v1 vs fast-follow                                                   | Split. Part B (layered staleness) ships in v1 as a maintainer-reliability commitment, prioritized with M3 ahead of M4–M6. Part A (agent surface) is the minimal cut candidate — rides on M5, fast-follows if the core runs hot. Both keep the hard local/read-only/no-network gates.                                    |
| D19 | Standalone/personal skills as a generic installer vs a pinned source kind | Pinned source kind (`kind: git`), not a generic installer. Reserved in M1 (parse-and-reject), implemented post-M2 once the lockfile can pin the ref + content hash. Materialized into a gitignored managed dir; identified by the pinned ref, never the path. Unpinned hand-dropped local dirs stay out of scope (§14). |
| D20 | Agent Skills frontmatter compliance (#116, #140)                          | Enforce spec compliance in M3. Only the six spec keys at top level; Intent scalars move under `metadata`; arrays (`sources`, `requires`) move to the manifest. `validate` errors on non-spec keys with a `--fix` migration. No backward-compat shim.                                                                    |

## 14. Out of scope for v1

- Skill signing / provenance (sigstore-style). Future hardening.
- A general package-manager vulnerability scanner — Intent flags lifecycle scripts on _skill packages only_.
- Storing or rotating secret values. Intent only records declared _names_.
- Approval UI beyond a terminal prompt.
- Cross-language MCP tool sandboxing.
- Transitive skill trust. Consumers approve each skill-bearing source explicitly in v1. A listed package does not authorize skills in its dependencies.
- **Unpinned** local-directory skill sources — `file:` paths, `~/` personal skill collections, or any arbitrary hand-dropped local directory the scanner would trust by presence alone. Intent's goal is library knowledge distribution as _pinned, versioned_ sources; an unpinned drop-zone re-opens the over-permissive trust default M1 closes. Skills a developer wants to add by hand with no pinning stay in a personal/global skills directory, outside Intent — the developer's own responsibility, not an Intent source kind. **Note:** a _pinned_ standalone curated source (`kind: git`, reserved — §2, D19) is the in-model way to bring a personal/curated skills repo under Intent's lockfile; it is deferred to post-M2, not rejected. The line is pinning, not "npm package vs not."
- A dedicated config-mutation command for excludes (`intent skills exclude …`). Excludes are low-frequency, set-once, and already trivial to edit as declarative JSON that reviews well in a PR. Adding a command means a second write target (alongside `intent.lock`), package.json merge/formatting edge cases, and pressure to ship a matching `add`/`remove` family. v1 instead keeps excludes hand-edited and makes `scan`/`diff` print the exact line to paste. Revisit as a fast-follow if demand appears.
- Webhook-driven staleness detection. Webhook payloads are attacker-influenceable (forged webhooks can trigger false update PRs or suppress real ones). v1 staleness is pull-based and local (M7 Part B). Cross-repo TanStack-internal workflows can keep their own out-of-package scripts.
- Semantic-anchor staleness (Layer 3 in M7's layered model). Coupling skills to API symbols for symbol-level drift detection is the highest-precision approach but the heaviest to build and adds attack surface to the detector itself. v1 ships Layers 0–2; Layer 3 tracked for a future release.
- Tightening skill content to the non-derivable layer. A reviewer observed that generated skills often restate API surface — signatures, type definitions, exhaustive option lists — that an agent can already scan directly from a library's published `.d.ts` and source. That restatement adds no agent knowledge and is exactly the content that drifts on every API change, inflating M7's Layer 1–2 staleness signal. The principle: skills should capture what a type scan cannot derive — which API to reach for, the parameter and option interactions that matter, ordering and lifecycle invariants, and failure modes — not transcribe the surface itself. A future pass sharpens the `generate-skill` meta-skill's extract / don't-extract guidance and its validation checklist around this, which also shrinks the surface a future Layer 3 would have to track. This is authoring guidance, not a security boundary, so it sits outside the v1 security core.
- Telemetry. Intent does not phone home in v1.
