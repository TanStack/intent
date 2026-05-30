# RFC: TanStack Intent v1 — Security, Lockfile & MCP

**Status:** Open for comment — for maintainer review before implementation.
**Reading guide:** §0 is "state of the world today" — start here if you're not deeply familiar with the codebase. §1–4 are settled problem + context. §5–11 are the design. Open decisions appear inline as **> Open question — Dx** callouts at the point they matter, and are consolidated in §13. Only **D1 blocks the critical path.**

---

## 0. State of the world today

> **Read this section first if you're not deeply familiar with the codebase.** It describes what `@tanstack/intent` actually is and how it works right now, so the problem statement and design in §1–§5 are grounded in something concrete.

### What is `@tanstack/intent`?

`@tanstack/intent` (`v0.0.41` at time of writing) is a CLI tool with two distinct audiences:

- **Library maintainers** use it to author, validate, and publish [Agent Skills](https://agentskills.io) — structured markdown documents (`SKILL.md`) that teach AI coding agents how to use a library correctly. Skills are shipped inside the library's npm package under a `skills/` directory and versioned alongside the library's code.
- **Consumers** (app developers) use it to discover which skills are available from their installed dependencies, and to surface those skills to their AI coding agent.

The package ships a single CLI binary (`intent`) with today's commands:

| Command | Audience | What it does |
|---|---|---|
| `intent list` | Consumer | Walks `node_modules` and prints every discovered skill |
| `intent load <use>` | Consumer / agent | Loads a specific `SKILL.md` and prints it to stdout (used by agent auto-loading) |
| `intent install` | Consumer | Prints an agent setup snippet (edits to `.cursorrules`, GitHub Copilot instructions, etc.) |
| `intent meta [name]` | Consumer | Lists or prints meta-skills (skills that describe Intent itself) |
| `intent scaffold` | Maintainer | Scaffolds a new `skills/` directory with a starter `SKILL.md` |
| `intent validate` | Maintainer | Validates all `SKILL.md` files in the current package against the schema |
| `intent stale` | Maintainer | Checks whether skills are out-of-date with library version / source code |
| `intent edit-package-json` | Maintainer | Adds the `intent` field and `tanstack-intent` keyword to `package.json` |
| `intent setup-github-actions` | Maintainer | Writes a CI workflow that validates and checks staleness |

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
    "requires": ["@tanstack/query"]  // optional load-order hint
  }
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

That model works as long as the only skills in the world are from a small set of trusted authors. Once skills become a broader ecosystem (third-party packages, monorepo internal skills, file-system skill sources), Intent needs:

1. **Explicit trust** — the project declares which skill sources it uses.
2. **Reproducibility** — what was approved is what's loaded, byte-for-byte.
3. **Reviewable change** — content/capability/source changes require an approval step.
4. **Capability gating** — skills declare what they do (read, write, network, secrets, downloads, MCP tools), and consumers approve at that granularity.
5. **Non-interactive safety** — CI runs and the MCP server both operate in a frozen mode that fails on drift rather than prompting.

## 2. Distribution model (sets the trust boundary)

**Hard rule (preserved from prior design decisions):** library packages ship **data only** — `skills/` directory, manifest (M3), `keywords: ["tanstack-intent"]`. They **never** ship bins or runtime code. See §3.

- **Library authors** install `@tanstack/intent` as a **devDependency**. They author/validate/CI their skills locally. Maintainer-facing commands (`scaffold`, `skills validate`, `skills generate-manifest`, `edit-package-json`, `setup-github-actions`, `skills stale`) run from this devDep install.
- **Consumers** (app projects) reach Intent functionality by either:
  - Installing `@tanstack/intent` as a **devDependency** (required for any project that commits `intent.lock` — keeps tooling pinned and reproducible), or
  - Running `npx @tanstack/intent@<exact-version>` for one-off discovery (`intent list`, `intent install`). Not suitable for lock-driven workflows; `intent skills scan/approve/diff/update`, `intent mcp serve`, and `intent security doctor` should always run from a pinned devDep install.
- The MCP server is `intent mcp serve` — same bin, runs from the consumer's devDep install only (`npx` is not supported for `mcp serve` in v1 — see D11). It is **not** shipped from inside library packages.
- **`intent.lock`** lives in the **consumer project root**, committed.
- Within `@tanstack/intent` itself, security-relevant logic lives in standalone modules (`scanner`, `lockfile`, `manifest`, `mcp`, `policy`, `secrets`) so commands stay thin and the same logic is reused across CLI, MCP, and tests.

## 3. Audit of prior design decisions to preserve (no regressions)

These were deliberately changed in earlier iterations. The v1 plan must not re-introduce them.

| Past decision                                                                                                                                            | Evidence in repo                                                                                                                                                                                                                                                          | Implication for v1                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Library packages do not ship bins.** Detection moved from `bin.intent` to `keywords: ["tanstack-intent"]`.                                             | `library-scanner.ts:isIntentPackage` comment: _"Legacy fallback: packages published before the keyword-based detection change may only have bin.intent. Keep this until a breaking release."_                                                                             | Don't propose any v1 feature that requires a library package to ship an executable (no per-library MCP server, no per-library `intent-library` bin, no per-library policy enforcer). Anything that needs runtime lives in `@tanstack/intent`.             |
| **Consumer discovery today is over-permissive — `skills/` dir + derivable `intent` config is enough.** The keyword is _not_ a gate on the consumer side. | `scanner.ts:tryRegister` registers any installed package with a `skills/` directory and a `validateIntentField`-passable or `deriveIntentConfig`-derivable config. No keyword check. The keyword check exists only in the abandoned `library-scanner.ts:isIntentPackage`. | M1's explicit-sources list **replaces** today's permissive default. The keyword stays as a marker for registry indexing and as a sanity hint, but it does not authorize consumer trust. After M1, presence in `intent.skills[]` is the authorization.     |
| **Discovery is static. Scanner never imports user code.**                                                                                                | `scanner.ts` and `library-scanner.ts` use `readFileSync` + `createRequire().resolve(.../package.json)` only. No `await import(<userPkg>)`.                                                                                                                                | M1 codifies this with a code-comment invariant + ESLint `no-restricted-imports` rule scoped to `scanner.ts`, `manifest.ts`, `lockfile.ts`, and `mcp/`. Manifest generation in M3 must stay static. MCP server in M5 must not load library code (see D12). |
| **Consumer-facing config lives in `package.json` (under `intent`), not in a separate config file.**                                                      | `scanner.ts:validateIntentField` reads `package.json#intent`. There is no `intent.config.json` in the repo.                                                                                                                                                               | Resolved: sources go in `package.json#intent.skills[]`. D2 closed.                                                                                                                                                                                        |
| **`bin.intent-library` was a planned consumer path that was abandoned in favor of the keyword model.**                                                   | `intent-library` bin exists in `package.json`, plus `src/intent-library.ts` + `src/library-scanner.ts`. `scanLibrary(process.argv[1])` walks up from the bin's own script path — only meaningful inside a library's `node_modules`.                                       | Do **not** revive this in v1. See §4.                                                                                                                                                                                                                     |

## 4. Cleanup item (blocks M1)

Remove the vestiges of the abandoned library-bin model:

- `bin.intent-library` entry in `packages/intent/package.json` (and remove from `build` script's tsdown entry list).
- `packages/intent/src/intent-library.ts`.
- `packages/intent/src/library-scanner.ts`.
- Their tests (`tests/library-scanner.test.ts`).
- The `bin.intent` legacy fallback inside `isIntentPackage` — gone naturally when `library-scanner.ts` is removed.

This is a breaking change (anyone wiring `intent-library` directly will break) but the surface area appears unused externally. It must happen before M1 so there's one discovery path to reason about.

> **Open question — D1 (P0, blocks rollout):** Remove `intent-library` bin + sources as v1 prep, or keep them as no-ops through one more release with a deprecation notice in the README?
> **Lean:** Remove now. Vestiges of an abandoned model; keeping them forces M1 to reason about two discovery paths.
> **Vote:** `[ ] A remove now   [ ] B deprecate one release` —

---

## 5. Milestones

Each milestone is independently shippable. The first four are sequential; M5 and M6 can move in parallel once M3 lands.

### M1 — Explicit skill sources + static-discovery invariant

**Goal:** Stop trusting every installed package with a `skills/` directory. Make the project's allowlist the sole gate.

- Read `package.json#intent.skills[]` as the project's allowlist (D2 closed).
- Source kinds, v1:
  - `"@scope/pkg"` or `"pkg"` — npm package, must be reachable via the project's dependency tree (direct or transitive).
  - `"workspace:@scope/pkg"` — a package in the current workspace. Works for npm, pnpm, yarn, bun workspaces — the `workspace:` prefix is Intent-internal syntax, not a package-manager protocol.
  - `"file:./relative/path"` — a local directory containing `skills/`. Resolved relative to the project root. Must remain inside the project root.
- `scanForIntents()` filters discovered packages against the allowlist:
  - Listed + found → included.
  - Listed + not found → warning ("declared in intent.skills but not installed"). In M2 frozen mode this becomes a hard fail.
  - Not listed + found (has `skills/` dir) → warning ("found skills in <pkg> but not in intent.skills — add it to opt in"). In M2 frozen mode this becomes a hard fail.
- Hard invariant: never `await import()` user package code. Add a code-comment invariant and an ESLint `no-restricted-syntax` rule prohibiting dynamic `import()` of computed paths inside `scanner.ts`, `lockfile.ts`, `manifest.ts`, and `mcp/`.
- The `tanstack-intent` keyword is no longer required for consumer discovery. Still recommended for registry indexing.

**Touches:** `scanner.ts`, `types.ts` (add `IntentProjectConfig.skills`), `commands/list.ts`, `eslint.config.js`, new tests in `tests/scanner.test.ts`. Removes (via §4 cleanup): `library-scanner.ts`, `intent-library.ts`, related tests.

**Migration:** existing projects with no `intent.skills[]` keep seeing skills load (with a one-line "declare your sources" warning) until M2 flips the default to fail-closed in frozen mode. Interactive use stays warn-only.

### M2 — Lockfile + approve / diff / update + frozen mode

**Goal:** Make discovery reproducible and changes reviewable.

New file `intent.lock` (committed at consumer project root):

```jsonc
{
  "lockfileVersion": 1,
  "generatedAt": "2026-05-26T...",
  "intentVersion": "1.0.0",
  "sources": [
    {
      "id": "@tanstack/router",
      "kind": "npm",
      "version": "1.42.0",
      "packageRoot": "node_modules/@tanstack/router",
      "manifestHash": "sha256-...", // null if package has no M3 manifest yet
      "contentHash": "sha256-...", // hash over all SKILL.md bytes, sorted by name
      "capabilities": ["reads_project_files"],
      "declaredSecrets": [],
      "downloads": false,
      "installs": false,
      "mcpTools": [],
      "mcpPolicy": {},
    },
  ],
}
```

`manifestHash` is nullable so M2 ships before M3 lands without an interlock. Once a package publishes an M3 manifest, its hash becomes part of the diff.

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
- No `execFileSync`/`execSync` against user-side tools (`gh`, `pnpm root -g`, etc.). `feedback.ts:submitFeedback` is interactive-only and not invoked in CI today; the guard makes that explicit.

**First-run behavior (no lockfile present):**

- `intent skills scan` reports "no intent.lock — run `intent skills approve --all` to create one."
- `intent skills approve --all` writes the initial lockfile from currently-installed sources matching `intent.skills[]`.
- Frozen-mode commands refuse to run without a lockfile: "no intent.lock found; run interactively first."

**Touches:** new `lockfile.ts`, new `hash.ts`, new `commands/skills-{scan,approve,diff,update}.ts`, new `mode.ts` (frozen-mode detection), gate calls in `staleness.ts` + `feedback.ts` + `utils.ts:detectGlobalNodeModules`.

> **Open question — D4 (P1, shapes M2):** Single `intent.lock` vs `.intent/lock.json` + `.intent/audit.log`. Single file is simpler; folder lets the human-readable audit log (every approve/update with timestamp and what changed) live separately from the machine-managed lock.
> **Lean:** Single file. Folder only if maintainers want the separate audit log now.
> **Vote:** `[ ] A single file   [ ] B .intent/ folder` —

### M3 — Manifest schema + `intent skills generate-manifest` + extended `intent skills validate`

**Goal:** Give skill packages a stable, hashable surface separate from `SKILL.md` content. Authored by maintainers, consumed by the lockfile diff on the consumer side.

New file per skill package: `skills/intent.manifest.json` (ships with the package).

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
      "mcpTools": [],
    },
  ],
}
```

- `intent skills generate-manifest` — walks `skills/`, computes content hashes, runs static heuristics (regex scan for `curl|wget`, `npm i|pnpm add|yarn add|bun add|pip install`, `SECRET_PATTERNS` from the shared `secrets.ts` module, fenced code blocks containing `child_process`/`spawn`/`exec`), and emits a manifest pre-filled with the heuristic findings. The maintainer reviews the diff and commits. Static analysis **informs** the manifest; the maintainer has final say on declared capabilities.
- `intent skills validate` (replaces today's flat `intent validate`):
  - All existing SKILL.md format/length/frontmatter checks.
  - Manifest exists, parses, every `SKILL.md` is listed, every listed path exists.
  - Stored `contentHash` matches actual content (catches missed regenerate).
  - Static heuristics agree with declared capabilities. Disagreement → warning, not error. Hard error only if a literal secret value matches `SECRET_PATTERNS` in skill body — the maintainer can declare a secret _name_ (`GITHUB_TOKEN`) but never embed a value.
- `SECRET_PATTERNS` moves from `feedback.ts` into a new `secrets.ts` module so scanner, validator, manifest generator, and feedback share one source.

**Touches:** new `manifest.ts`, new `secrets.ts` (move + add patterns), new `commands/skills-generate-manifest.ts`, refactor `commands/validate.ts` → `commands/skills-validate.ts`, types.

> **Open question — D5 (P1, shapes M3):** Package-level `skills/intent.manifest.json` (one file per package, easiest to hash and diff atomically) vs per-skill `intent.skill.json` files (smaller individual diffs, more files to ship and reconcile).
> **Lean:** Package-level.
> **Vote:** `[ ] A package-level   [ ] B per-skill` —

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
  - `reject` writes a `"rejected": true` marker into the lockfile so the diff doesn't re-surface every run.

- Secrets remain names-only across the system — Intent records what a skill declares it needs, never the values.

**Touches:** extends `lockfile.ts`, `commands/skills-{approve,diff}.ts`. No major new files.

### M5 — MCP server

**Goal:** Expose the approved skill catalog over MCP so coding agents can query it without scraping files. Ship it alongside the security model so MCP behavior is gated by the lockfile from day one.

**Tool surface (v1) — all implemented inside `@tanstack/intent`. No tool implementations are loaded from library packages.**

Built-in read-only tools, always available when a lockfile exists:

- `list_skills` — compact skill index (name, package, description, capabilities summary).
- `get_skill(name)` — full `SKILL.md` body for one approved skill.
- `search_skills(query)` — text search across approved skill index.
- `get_lock` — current `intent.lock` (lets an agent verify its view).
- `get_diff` — current pending diff between lockfile and installed state.

Skill-declared `mcpTools[]` (in manifest) is **metadata only** in v1. It describes tools the skill _says_ its library exposes elsewhere. Intent records these in the lockfile, requires explicit policy entries before treating them as approved, and surfaces them via `list_skills`, but does **not** wire runtime for them — that would require importing library code and breaks the static-discovery invariant.

Policy entries in `intent.lock`:

```jsonc
"mcpPolicy": {
  "search_routes": "allow",
  "delete_route": "deny"
}
```

`allow` means the agent is told this tool exists and is approved; `deny` hides it. There is no third `prompt` value in v1 (would require a runtime confirmation channel — see D13).

**Implementation:**

- Lives in `packages/intent/src/mcp/` (server + tool definitions). Subcommand `intent mcp serve`.
- Transport: stdio only in v1 (D6 closed — matches Claude Code, Cursor, Copilot CLI defaults).
- Always runs in frozen mode. Lockfile mismatch → server starts but every tool returns a structured error pointing at `get_diff`. Server never mutates state.
- New dependency: `@modelcontextprotocol/sdk` (eval first; if too heavy, write a minimal stdio JSON-RPC handler).

**Touches:** new `mcp/server.ts`, new `mcp/tools/*.ts`, new `commands/mcp-serve.ts`, types.

> **Open question — D11 (P1, shapes M5):** `intent mcp serve` from `npx` — support, or require devDep? **Lean:** Require devDep; `npx` per-invocation is too slow for MCP and breaks pinning. **Vote:** `[ ] A devDep-only   [ ] B allow npx` —
>
> **Open question — D12 (P1, shapes M3/M5):** Reserve the manifest shape for future skill-supplied MCP tool implementations (WASM/sandboxed workers), or keep `mcpTools[]` as pure metadata? **Lean:** Pure metadata, but design `mcpTools[]` to be forward-extensible. **Vote:** `[ ] A extensible metadata   [ ] B minimal metadata` —
>
> **Open question — D13 (P2, confirm out of v1):** Interactive `prompt`-level MCP policy (server pauses, asks user via separate channel). **Lean:** Out of v1. **Vote:** `[ ] Out of v1 (confirm)   [ ] Include in v1` —

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

Exit code: non-zero if any `error`-level issue is present. Issues with explicit allow/ignore markers in `intent.lock` are skipped.

**Touches:** new `commands/security-doctor.ts`. No new shared modules.

## 6. CLI grouping

One bin (`intent`), nested verbs. Used by maintainers (from devDep) and consumers (from devDep, or `npx` for non-lockfile commands).

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
intent install                    # prints agent setup prompt; no lockfile required
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
- `intent install` keeps its existing meaning (prints agent setup prompt) even though it doesn't _install_ anything. Renaming is out of v1 scope but tracked (see D14).
- `intent meta` (listing meta-skills) keeps its current behavior; orthogonal to the skill-discovery surface.

> **Open question — D7 (P1, shapes CLI from M2 on):** Nested verbs (drafted) vs flat (`intent scan`, `intent approve`, `intent diff`, `intent update`, `intent serve-mcp`, `intent doctor`). **Lean:** Nested — scales better as verb count grows. **Vote:** `[ ] A nested   [ ] B flat` —
>
> **Open question — D14 (P2, confirm defer):** Rename `intent install` (prints the agent prompt) to something less misleading, e.g. `intent setup` or `intent agent-prompt`? **Lean:** Defer to a follow-up; keep `intent install` for v1. **Vote:** `[ ] Defer rename (confirm)   [ ] Rename in v1 → ____` —

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

> **Open question — D9 (P2, confirm out of v1):** Per-skill (not per-package) approvals? **Lean:** Out of v1; revisit if real demand. **Vote:** `[ ] Out of v1 (confirm)   [ ] Include in v1` —

## 9. Versioning summary

| Artifact                      | Field                                | Source of truth | Bump policy                                                                                           |
| ----------------------------- | ------------------------------------ | --------------- | ----------------------------------------------------------------------------------------------------- |
| `intent.lock`                 | `lockfileVersion`                    | M2              | Bumped on incompatible shape change; reader rejects unknown majors.                                   |
| `skills/intent.manifest.json` | `manifestVersion`                    | M3              | Bumped on incompatible shape change; older consumers warn and fall back to content-hash-only diffing. |
| `@tanstack/intent` CLI        | `intentVersion` recorded in lockfile | M2              | Informational; security doctor warns on >1 minor behind.                                              |
| MCP tool schema               | implicit via tool name + arg shape   | M5              | Breaking changes require a new tool name.                                                             |

> **Open question — D10 (P2, confirm not v1):** Publish `@tanstack/intent-types` so library tooling can depend on just types? **Lean:** Not v1; open a tracking issue. **Vote:** `[ ] Not v1, track issue (confirm)   [ ] Do it in v1` —

## 10. Testing strategy

- **M1:** unit tests in `tests/scanner.test.ts` covering the allowlist matrix (listed/found, listed/missing, unlisted/found, file/workspace/npm kinds). Integration test confirming a fresh project with no `intent.skills[]` emits the migration warning exactly once.
- **M2:** fixture-driven lockfile round-trip tests (parse → write → parse byte-identical). Frozen-mode integration tests asserting non-zero exit on each drift category. First-run test: no lockfile → `scan` reports missing, `approve --all` creates it.
- **M3:** manifest schema validation tests. `generate-manifest` golden-file tests over representative SKILL.md fixtures. Round-trip with `scan` (manifest → lockfile manifestHash).
- **M4:** diff-rendering snapshot tests for each capability/MCP/version-change category.
- **M5:** MCP server tested via the SDK's in-memory transport — `list_skills`, `get_skill`, `get_diff` over fixture lockfiles, including the lockfile-mismatch error path.
- **M6:** doctor tests assert correct issue classification (error/warning/info) for each check.

Existing test commands (`test:lib`, `test:integration`, `test:smoke`) absorb the new tests without new infrastructure.

## 11. Performance notes

- Content hashing across a large monorepo's `node_modules` (hundreds of skill files) is the main cost. Mitigations: hash incrementally per-file, cache by file mtime+size in `.intent/cache.json` (gitignored), short-circuit when both manifest and lockfile entry already exist with matching `manifestHash`.
- The MCP server loads the lockfile once at start and only re-reads on SIGHUP (or file watcher in a follow-up).
- No mitigations needed in v1 for projects under ~50 sources; revisit if profiling shows otherwise.

## 12. Docs work (per milestone)

- **Cleanup + M1:** README + `docs/overview.md` + `docs/registry.md` updated for devDep-first install. New `docs/security/trust-model.md` (explicit sources + static-discovery invariant). Migration guide `docs/migration/v0-to-v1.md`.
- **M2:** `docs/security/lockfile.md`, `docs/cli/intent-skills.md` (scan/approve/diff/update). Frozen-mode reference.
- **M3:** `docs/security/manifest.md`, `docs/cli/intent-skills-validate.md`, `docs/cli/intent-skills-generate-manifest.md`.
- **M5:** `docs/mcp/overview.md`, `docs/mcp/policy.md`, `docs/cli/intent-mcp-serve.md`.
- **M6:** `docs/cli/intent-security-doctor.md`, troubleshooting page.
- `CONTRIBUTING.md` gets a "decisions to preserve" pointer to §3 so contributors don't unwittingly regress.

**Token efficiency (cross-cutting):**

- Lockfile + manifest are full-fidelity (verification).
- Compact skill index for agent selection is **derived** from the manifest on the consumer side (built by `intent skills scan`, cached in `.intent/cache.json`). One source of truth, no separate shipped artifact.
- Index payload per skill: name + description + capabilities-summary + path. No body text.
- `SKILL.md` body is lazy-loaded only when an agent calls `get_skill(name)` or reads the path directly.

---

## 13. Decisions — consolidated

How to vote: reply inline on a decision's vote line with your initials + choice. When consensus is reached, move it to **Resolved** and update this section.

### Status table

| ID     | Topic                                                | Lean                      | Blocks rollout?      | Priority |
| ------ | ---------------------------------------------------- | ------------------------- | -------------------- | -------- |
| **D1** | Remove `intent-library` bin+sources now vs deprecate | Remove now                | **Yes — gates M1**   | P0       |
| D4     | Single `intent.lock` vs `.intent/` folder            | Single file               | No (shapes M2)       | P1       |
| D5     | Package-level vs per-skill manifest                  | Package-level             | No (shapes M3)       | P1       |
| D7     | Flat vs nested CLI verbs                             | Nested                    | No (shapes CLI, M2+) | P1       |
| D11    | `intent mcp serve` via `npx` vs devDep-only          | devDep-only               | No (shapes M5)       | P1       |
| D12    | `mcpTools[]` pure metadata vs reserve for impls      | Pure metadata, extensible | No (shapes M3/M5)    | P1       |
| D9     | Per-skill (not per-package) approvals                | Out of v1                 | No                   | P2       |
| D10    | Publish `@tanstack/intent-types`                     | Not v1                    | No                   | P2       |
| D13    | Interactive `prompt`-level MCP policy                | Out of v1                 | No                   | P2       |
| D14    | Rename `intent install`                              | Defer to follow-up        | No                   | P2       |

Full context for each lives inline in the section it affects (D1 §4, D4 M2, D5 M3, D7/D14 §6, D9 §8, D10 §9, D11/D12/D13 M5).

### Resolved (audit trail — already closed)

| ID  | Question                                                         | Resolution                                                      |
| --- | ---------------------------------------------------------------- | --------------------------------------------------------------- |
| D2  | Sources in `package.json#intent.skills` vs `intent.config.json`? | `package.json#intent.skills[]` — matches prior decision.        |
| D3  | Drop `bin.intent` legacy fallback in `isIntentPackage`?          | Yes — goes away naturally when D1 removes `library-scanner.ts`. |
| D6  | MCP transport: stdio only vs stdio + HTTP/SSE?                   | Stdio only in v1.                                               |
| D8  | What does an "unlisted source" do in M1?                         | Warn in M1; hard fail in M2 frozen mode.                        |

### Suggested decision flow

1. **Decide D1 first** — it unblocks M1 and nothing else can start until it's settled.
2. Sweep the **P1 design questions** (D4, D5, D7, D11, D12) — each pins one milestone's shape; cheap now, expensive after implementation starts.
3. Rubber-stamp the **P2 "out of v1" items** (D9, D10, D13, D14) — just need an explicit "yes, defer."
4. Move every closed item into the Resolved table and update §13's status table.

## 14. Out of scope for v1

- Skill signing / provenance (sigstore-style). Future hardening.
- A general package-manager vulnerability scanner — Intent flags lifecycle scripts on _skill packages only_.
- Storing or rotating secret values. Intent only records declared _names_.
- Approval UI beyond a terminal prompt.
- Cross-language MCP tool sandboxing.
- Per-transitive-dependency approval. Consumers approve at the boundary they declared in `intent.skills[]`; transitive trust follows the dependency tree.
- Telemetry. Intent does not phone home in v1.
