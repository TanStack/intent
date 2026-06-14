# RFC: TanStack Intent v1 — Security, Lockfile & MCP

**Status:** Open for comment — for maintainer review before implementation.
**Reading guide:** §0 is "state of the world today" — start here if you're not deeply familiar with the codebase. §1–4 are settled problem + context. §5–12 are the design. §13 contains the resolved decision audit trail.

> **Implementation status (verified 2026-06-14 against `main`; `rfc` branch now at parity with `main`; latest release `0.1.0`, M1 shipped).**
>
> | Item                                                                    | Status                                                                                                                                                                                                  |
> | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
> | §4 — `intent-library` cleanup                                           | ✅ **done** (bin, `intent-library.ts`, `library-scanner.ts`, `library-scanner.test.ts` removed; no refs remain in `src`)                                                                                |
> | M1 — explicit skill sources                                             | ✅ **shipped in `0.1.0`** (#156, #157; `core/skill-sources.ts`, `core/source-policy.ts` gate discovery behind the `intent.skills` allowlist)                                                            |
> | M1 — exclude command + notice controls                                  | ✅ **shipped in `0.1.0`** (#157; flat `intent exclude` add/remove/list, skill-level `intent.exclude`, `--no-notices`/`INTENT_NO_NOTICES`; one-off `--exclude` flag removed — supersedes §14, see §3/M1) |
> | M2 — lockfile + frozen mode                                             | ⬜ not started                                                                                                                                                                                          |
> | M3 — manifest + Agent Skills spec compliance (D20)                      | ⬜ not started                                                                                                                                                                                          |
> | M4 — capability-aware diff                                              | ⬜ not started                                                                                                                                                                                          |
> | M5 — MCP server                                                         | ⬜ not started                                                                                                                                                                                          |
> | M6 — `security doctor`                                                  | ⬜ not started                                                                                                                                                                                          |
> | M7 Part B — staleness hardening (1.0 maintainer-reliability commitment) | ⬜ not started                                                                                                                                                                                          |
> | M7 Part A — maintainer agent surface (cut candidate, rides on M5)       | ⬜ not started                                                                                                                                                                                          |
> | P1 — personal source overlay (`intent.local.json`, D25)                 | 🟦 resolved, deferred (fast-follow after M2, “M2.5”; not started)                                                                                                                                       |
> | P2 — allowlist editor + bootstrap (`intent skills add`/`init`, D24/D26) | 🟦 resolved, deferred (post-M1; first-run polish ~M5; not started)                                                                                                                                      |
>
> Note: the `rfc` branch is now at parity with `main` (verified 2026-06-14: 0 commits behind, the only working-tree difference is this `V1-RFC.md`). The removed `intent-library` files are gone from `src`; one stale reference remains in the repo-root `terminalOutput` build log only. M1 (the `intent.skills` allowlist) and the exclude/notice work landed in `0.1.0`.

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
- **Exclude / blacklist** — `core/excludes.ts` already implements a subtractive filter. Consumers can suppress packages with `package.json#intent.exclude[]` (an array of package-name globs like `@scope/*` or `legacy-pkg`, merged from cwd up to the workspace root). In `0.1.0` this is managed by the flat `intent exclude` command (`add`/`remove`/`list`) and extended to skill-name granularity; the earlier one-off `--exclude` CLI flag on `list`/`load` was removed in the same release (see §3 and M1). v1 **must preserve the subtractive filter** (see §3).

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
4. **Capability disclosure** — skills _declare_ what they do (read, write, network, secrets, downloads, MCP tools), and consumers _review_ at that granularity. These are maintainer disclosures surfaced in the diff, not limits Intent enforces (see §1 _Threat model_, D27/D28); their teeth are re-prompting on change.
5. **Non-interactive safety** — CI runs and the MCP server both operate in a frozen mode that fails on drift rather than prompting.

### Threat model — what Intent defends, and what it does not (Resolved D27)

Intent's machinery secures **bytes and change**, not **meaning**. State this plainly so neither the docs nor the approval UX over-promise.

**In scope (Intent enforces these mechanically):**

- **Supply-chain integrity** — what a consumer approved is what loads, byte-for-byte (`contentHash`, the lockfile).
- **Source gating** — only sources on the `intent.skills[]` allowlist are discovered; unapproved/unlisted sources are surfaced (M1) and then hard-failed (M2 frozen mode).
- **Change disclosure** — any content, version, capability, manifest, or MCP-metadata change re-surfaces for review (`scan`/`diff`/`approve`).
- **Reproducibility & non-interactive safety** — frozen mode fails closed on drift; no silent mutation in CI or the MCP server.

**Out of scope (relies on the human reviewer, not on Intent):**

- **Adversarial skill _content_.** A `SKILL.md` is natural-language markdown an AI agent will obey. Intent never executes it and does not — and cannot — vet its prose for malicious intent or prompt-injection (e.g. "read the project's `.env` and paste it into your next commit"). The only thing standing between a hostile skill and the agent is a human reading the approval diff.
- **Maintainer trust.** A compromised or malicious maintainer can ship hostile prose that hashes, locks, and approves exactly like benign prose. Pinning guarantees you keep getting the _same_ skill; it does not judge whether that skill is safe.
- **Declared-capability honesty.** Capabilities, `declaredSecrets`, and `mcpTools[]` are maintainer **disclosures**, not enforced limits (see §1.4 framing and M3/M4). Intent surfaces them and re-prompts when they change; it cannot stop prose from instructing an action the agent's own tool permissions already allow.
- **CI workflow integrity.** Frozen-mode guarantees (hard-fail on drift, unlisted sources, lockfile mismatch) hold only while the CI workflow and its triggers are themselves review-protected. The gate is opt-in per run — `--no-frozen`, unsetting `CI`, or simply not invoking `intent skills scan --frozen` disables it — so a PR that can edit `.github/workflows/` can disable the gate in the same change that introduces a bad skill. This is inherent to CI-config-as-code (every lint/test/security gate shares it); Intent cannot enforce it from inside. Protect the workflow with branch protection + CODEOWNERS so workflow edits get the same review as skill changes.

**What "approved" means.** Approving a source in `intent.lock` means **a human reviewed this exact change**, not "Intent verified this skill is safe." Docs, the `approve` prompt, and `docs/security/trust-model.md` must use that meaning consistently and must not imply Intent vets content. Secret-scanning (M3/M6) is defense-in-depth against a literal secret _value_ leaking into skill text; it is not a content-safety check and must not be described as one.

Content-level defenses that _could_ raise this bar — skill signing/provenance, prose-level injection analysis, sandboxed execution — are explicitly deferred (§14). v1's security posture is: **trust is established by human review of a reproducible, gated, fully-disclosed change**, and everything in the machinery exists to make that review honest and unavoidable, not to replace it.

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
- The file bytes read by the scanner, with line endings normalized to LF before hashing (see below).

Path rules:

- Use `/` separators.
- Preserve case.
- Reject absolute paths.
- Reject `.` / `..` segments that escape the package root.
- Never include physical read locations such as `node_modules`, `.pnpm`, or `.yarn/cache/*.zip`.

The aggregate hash sorts entries by normalized path using ordinal string order. Duplicate canonical paths are invalid. Skill `name` values are intentionally **non-unique** within a package — the package-relative path is the uniqueness key (D22). Duplicate `name` values are permitted and are never flagged; only duplicate canonical paths fail validation.

**Line-ending normalization before hashing (Resolved D32).** Intent normalizes line endings to LF (`\r\n` → `\n`, and a lone `\r` → `\n`) on the file bytes **before** computing the hash. It does not otherwise normalize content — no whitespace trimming, no Unicode normalization, no encoding changes — so every byte that carries meaning is still covered; only the CRLF-vs-LF representation difference is collapsed. This kills a phantom-drift failure class at the **author boundary**: `generate-manifest` hashes a maintainer's working-tree `SKILL.md`, whose line endings can differ from the published-tarball bytes (Windows `core.autocrlf` checkout = CRLF working tree, LF in the npm tarball). Without normalization, the manifest hash baked at author time would not match the `contentHash` a consumer computes from the installed bytes — a mismatch with no real content change, landing on library authors. CRLF-vs-LF is never a security signal, so normalizing it costs no integrity: every meaning-bearing byte is still hashed, the same `SKILL.md` yields the same hash on every OS and package manager, and `contentHash`/`manifestHash` stay comparable across the author→publish→consume path. This narrows the earlier "exact bytes including line endings" stance to "exact bytes after LF normalization" — a deliberate, security-neutral concession. A `.gitattributes` recommendation (M3) is the belt-and-suspenders complement, not a substitute: normalization at hash time is what guarantees correctness even when an author forgets it.

### Static discovery boundary

**Resolved:** Intent may execute package-manager resolution infrastructure, but must not execute discovered package code.

Static discovery means Intent reads package metadata and skill files as data. It does not mean "no project-local JavaScript ever runs." Yarn PnP requires loading package-manager resolution infrastructure such as `.pnp.cjs` / `pnpapi` to map package identities to readable package locations.

Allowed execution:

- The project's package-manager resolution API, used only to resolve package locators and readable package roots.

**Why executing the PnP runtime is acceptable, and the trust boundary it relies on (D31).** Loading `.pnp.cjs` / `pnpapi` does run project-local JavaScript in Intent's process — the one exception to "never execute discovered code." It is acceptable because the PnP runtime Intent loads is the **same manifest the project's own `node` already executes on every command**: Intent resolves it from the project/workspace root and walks **upward** toward the filesystem root (project root or an ancestor), exactly as Node/Yarn's own `findPnpApi` does. Executing it therefore grants Intent no capability the developer has not already granted their package manager. That trust argument holds **only** for the root-or-ancestor manifest — it does **not** extend to a `.pnp.cjs` / `pnpapi` shipped _inside a discovered package_ or found anywhere down the dependency tree; loading such a file would be the very "execute package-provided code" hole this boundary exists to close. Intent must never resolve the PnP runtime downward into a package.

> **Implementation status (D31).** On `main` this root-or-ancestor property is **emergent**, not asserted: `scanner.ts:loadPnpApi` is called with the project root and `findPnpFile` only walks upward, so a package-supplied `.pnp.cjs` is unreachable today — there is **no current bug**. But nothing _asserts_ the invariant, so a future refactor could pass a different root and silently break it. The defense-in-depth follow-up is a cheap guard that rejects a resolved PnP path under `node_modules` / a package directory, landed **with a test as part of the M1/M2 static-discovery-invariant hardening** (alongside the ESLint `no-restricted-syntax` rule), or folded into the next change that already touches `scanner.ts`. It is **not urgent** and does not warrant its own PR.

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

If package-manager resolution loading fails, Intent fails closed with a clear diagnostic. It must not fall back to importing candidate packages or running Node package resolution against package entrypoints. It must likewise fail closed rather than resolve a PnP runtime from a down-tree/package location (D31).

### Transitive skill trust

**Resolved:** trust does not propagate transitively in v1.

An entry in `package.json#intent.skills[]` authorizes only the explicitly declared source. For npm package sources, listing `pkg-a` authorizes skills discovered in `pkg-a` itself. It does not authorize skills discovered in dependencies of `pkg-a`.

If `pkg-a` depends on `pkg-b` and `pkg-b` provides skills, `pkg-b` must also appear in `intent.skills[]` before Intent loads its skills. In M1, an unlisted transitive skill source emits an unlisted-source warning. In M2 frozen mode, it is a hard failure unless the package is explicitly listed or excluded.

Implementations may include diagnostic context that explains why an unlisted source was discovered, such as `pkg-a -> pkg-b`. That relationship does not imply trust.

## 3. Audit of prior design decisions to preserve (no regressions)

These were deliberately changed in earlier iterations. The v1 plan must not re-introduce them.

| Past decision                                                                                                                                            | Evidence in repo                                                                                                                                                                                                                                                                      | Implication for v1                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Library packages do not ship bins.** Detection moved from `bin.intent` to `keywords: ["tanstack-intent"]`.                                             | `library-scanner.ts:isIntentPackage` comment: _"Legacy fallback: packages published before the keyword-based detection change may only have bin.intent. Keep this until a breaking release."_                                                                                         | Don't propose any v1 feature that requires a library package to ship an executable (no per-library MCP server, no per-library `intent-library` bin, no per-library policy enforcer). Anything that needs runtime lives in `@tanstack/intent`.                                                                                                                                    |
| **Consumer discovery today is over-permissive — `skills/` dir + derivable `intent` config is enough.** The keyword is _not_ a gate on the consumer side. | `scanner.ts:tryRegister` registers any installed package with a `skills/` directory and a `validateIntentField`-passable or `deriveIntentConfig`-derivable config. No keyword check. The keyword check exists only in the abandoned `library-scanner.ts:isIntentPackage`.             | M1's explicit-sources list **replaces** today's permissive default. The keyword stays as a marker for registry indexing and as a sanity hint, but it does not authorize consumer trust. After M1, presence in `intent.skills[]` is the authorization.                                                                                                                            |
| **Discovery is static. Scanner never imports user package code.**                                                                                        | `scanner.ts` and `library-scanner.ts` use `readFileSync` + `createRequire().resolve(.../package.json)` only. No `await import(<userPkg>)`.                                                                                                                                            | M1 codifies this with a code-comment invariant + ESLint `no-restricted-imports` rule scoped to `scanner.ts`, `manifest.ts`, `lockfile.ts`, and `mcp/`. Package-manager resolution infrastructure such as Yarn PnP is the only execution exception. Manifest generation in M3 and the MCP server in M5 must not load library code (see D12).                                      |
| **Consumer-facing config lives in `package.json` (under `intent`), not in a separate config file.**                                                      | `scanner.ts:validateIntentField` reads `package.json#intent`. There is no `intent.config.json` in the repo.                                                                                                                                                                           | Resolved: sources go in `package.json#intent.skills[]`. D2 closed.                                                                                                                                                                                                                                                                                                               |
| **`bin.intent-library` was a planned consumer path that was abandoned in favor of the keyword model.**                                                   | `intent-library` bin exists in `package.json`, plus `src/intent-library.ts` + `src/library-scanner.ts`. `scanLibrary(process.argv[1])` walks up from the bin's own script path — only meaningful inside a library's `node_modules`.                                                   | Do **not** revive this in v1. See §4.                                                                                                                                                                                                                                                                                                                                            |
| **Consumers can already exclude/blacklist packages.** A subtractive filter exists independent of any allowlist.                                          | `core/excludes.ts`: `package.json#intent.exclude[]` (package-name globs, merged from cwd up to workspace root). Glob support is `*`-only; exact names match exactly. As of `0.1.0` managed via the `intent exclude` command; the prior `--exclude` flag on `list`/`load` was removed. | M1's allowlist (`intent.skills[]`) is **additive** (opt-in); `intent.exclude[]` stays **subtractive** and is applied _after_ the allowlist. Removing the subtractive filter would be a regression. v1 also extends exclude to match skill names, not just package names, and ships a dedicated `intent exclude` command (see M1; supersedes the §14 "no exclude command" entry). |

## 4. Cleanup item (blocks M1)

> ✅ **Completed on `main` (@ `0.0.43`; docs/examples/CI search re-verified 2026-06-14).** The `intent-library` bin, `src/intent-library.ts`, `src/library-scanner.ts`, and `tests/library-scanner.test.ts` are removed; the `build` script no longer lists them; no `bin.intent` legacy fallback remains; `git grep` finds no residual references in shipped `src`/`package.json`. The docs/examples/CI usage search called for below is now complete — `intent-library`, `library-scanner`, `bin.intent`, and `intent library` appear nowhere in `docs/`, `scripts/`, `.github/`, `benchmarks/`, READMEs, or `meta/`; the only residual mention is the repo-root `terminalOutput` build log (stale, handled separately). No migration-guide break entry is needed. The original scope is preserved for the audit trail.

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

**Goal:** Stop trusting every installed package with a `skills/` directory. Make the project's allowlist the sole gate. **The allowlist ships in the 0.x line as the gate for projects that adopt it, but it does not become the _sole_ gate until the absent-state default flips from show-all to deny-all at 1.0 (D30); through 0.x the show-all default is deprecated-but-live so existing projects have a warned migration window.**

- Read `package.json#intent.skills[]` as the project's allowlist (D2 closed).
- **Model sources as a discriminated union from day one** (`{ id, kind, ... }`), not a flat list of package-name strings. This is the same source-identity shape M2's lockfile stores (`id`, `kind`, `version`, optional `resolution`), so M1 builds it once instead of M2 refactoring it. Each entry in `intent.skills[]` parses into a typed `SkillSource`; an unrecognized prefix is a clear error, never a silent drop.
- Source kinds, v1:
  - `"@scope/pkg"` or `"pkg"` — `kind: npm`. An npm package, must be reachable via the project's dependency tree (direct or transitive).
  - `"workspace:@scope/pkg"` — `kind: workspace`. A package in the current workspace. Works for npm, pnpm, yarn, bun workspaces — the `workspace:` prefix is Intent-internal syntax, not a package-manager protocol.
  - `"git:<host>/<repo>#<ref>"` — `kind: git`. A standalone curated/personal skills repository pinned to a ref. **Reserved in M1, not implemented.** M1 parses and validates the shape but rejects it with a "not supported until the lockfile lands" diagnostic, because a git source cannot be trusted without M2's pin (see §2 _Standalone curated sources_, D19). Implementing materialization in M1 — before there is a lockfile to pin the resolved ref and content hash — would re-open the over-permissive trust hole this milestone closes.
- **Allowlist-level states — absent vs empty vs wildcard (D21).** The list as a whole has three special interpretations, distinct from per-entry parsing:
  - **Absent** (`intent.skills` key not present) — legacy v0 behavior **for the 0.x line only**: **show all** discovered sources, plus a one-time deprecation warning that names the flip — at **1.0 the absent default becomes deny-all** and a project with no `intent.skills[]` will surface nothing until it opts in (D30). This is the warned upgrade path for existing projects, explicitly not a steady state and explicitly time-boxed to pre-1.0.
  - **Empty** (`intent.skills: []`, key present) — **deny all**. A deliberately empty allowlist permits no sources; it is a migrated project's explicit "surface nothing," not an oversight, so it emits a quiet info note ("`intent.skills` is empty — no skill sources permitted") rather than the absent-state deprecation warning. Absent and empty are never collapsed.
  - **Wildcard** (`intent.skills: ["*"]`) — **permit all discovered sources**, with a loud acknowledged-risk banner ("all skill sources allowed — unvetted skills may be surfaced into agent guidance"). The `"*"` sentinel flows through the same permit-all machinery as the absent state but carries the acknowledged-risk banner instead of the deprecation banner. **This banner is warning-level and non-suppressible (D35): it is emitted on the warning channel, not the informational-notice channel, and must _not_ be silenced by `--no-notices` or `INTENT_NO_NOTICES=1`.** A risk acknowledgment a CI run can quietly mute is not a safeguard — `--no-notices` may hush informational notices (migration/empty/unlisted hints), but never the permit-all risk banner. (Shipped `0.1.0` currently routes this banner through the suppressible notices channel; correcting that is a tracked v1 cleanup — see D35.)
  - **Wildcard composition is additive, not exclusive (decided: C).** `"*"` is not required to be the sole entry. The inevitable end state is `"*"` meaning "everything discovered in the dependency tree" composing **additively** with explicit `git:` entries that pull curated/personal repos which are _not_ in the dependency tree — e.g. `["*", "git:github.com/me/skills#main"]` reads as "all discovered sources **plus** my personal skills repo." Redundant npm/workspace entries alongside `"*"` are subsumed (no error). Because `git:` is parse-and-reject in M1 (D19), a `"*"` + `git:` list still fails the whole list under M1's git rejection until M2 materialization lands — the composition is the designed model, deferred only by git materialization, not a conflict to be re-litigated.
- **Filtering is a pure policy pass, separate from discovery.** `scanForIntents()` stays a pure raw discoverer — it never reads the allowlist. A new pure `applySourcePolicy()` filters the discovered packages against the parsed allowlist, and `scanForPolicedIntents()` composes the two (discover, then apply policy). This split keeps the scanner free of trust logic and makes the policy independently testable.
  - Listed + found → included.
  - Listed + not found → warning ("`<source>` is declared in intent.skills but was not discovered"). In M2 frozen mode this becomes a hard fail. The wording is deliberately "not discovered," never "not installed" — static discovery is never provably complete, so Intent reports what it failed to find, not an absolute claim about what is installed (D8).
  - Not listed + found (has `skills/` dir) → warning naming the discovered-but-unlisted packages ("N discovered package(s) ship skills but are not listed in intent.skills: … — add to opt in"). In M2 frozen mode this becomes a hard fail. **The warning is flat — it names each unlisted package, not the transitive chain that pulled it in.** Surfacing the parent chain (e.g. `pkg-a → pkg-b`) needs parent-edge data the `ScanResult` does not carry today; it is deferred to a later milestone (see §14), not part of M1.
- Trust does not propagate transitively. If a listed package depends on another package that provides skills, the dependency is still an unlisted source until it appears in `intent.skills[]`.
- **Matching is name-only in M1; `kind` is stored but not yet a match discriminant (F1).** The scanner emits no workspace-membership signal in M1 (deferred to M2/F2), so there is nothing to discriminate a workspace member from a published npm dependency at match time. Each `SkillSource` still carries its parsed `kind` (for M2's lockfile identity, which keys on `kind` + `id`), but M1 matches a discovered package against an allowlist entry by **normalized name only**. Consequence: `"foo"` (npm) and `"workspace:foo"` both authorize any discovered package named `foo`, and a workspace member and an npm package sharing a name collapse on the name. This looseness errs **permissive** (it can authorize a same-named package you didn't precisely mean, never deny one you listed) and is the pinned M1 baseline; M2 tightens it to a true `kind`+`id` match once the scanner gains the membership signal.
- **Exclude / blacklist is preserved and extended (regression guard — see §3).** The existing `package.json#intent.exclude[]` subtractive filter stays. Semantics in the allowlist world:
  - The allowlist (`intent.skills[]`) is **additive** (opt-in); `exclude[]` is **subtractive** and applied _after_ the allowlist resolves. A source can be admitted by the allowlist and then have specific skills suppressed.
  - v1 **extends exclude to skill-name granularity.** Today a pattern only matches a package name; v1 also matches a skill's `name` (e.g. `@scope/pkg`, `@scope/pkg#search-params`, or `*#experimental-*`), enabling exclusion of a single skill rather than a whole package. Backward compatible — bare package-name patterns keep working.
  - Excluded sources/skills never reach the lockfile, the diff, generated indexes, capability prompts, skill lookup, invocation, or the MCP server. An excluded-but-installed package does **not** trigger the "unlisted source" warning (exclude is an explicit decision, not an oversight).
  - **Dedicated `intent exclude` command (shipped `0.1.0`, #157 — supersedes the original "no exclude command" plan).** Excludes are managed by a flat top-level `intent exclude` command with `add`/`remove`/`list` actions that read and write `package.json#intent.exclude[]` in place. This was a deliberate choice to give excludes a managed surface symmetric with the additive allowlist-management command (`intent skills add`/`remove`/`list`, resolved as D24 in §15 P2) — `add`/`remove`/`list` verbs on both sides rather than hand-editing one and commanding the other. The written `exclude[]` stays declarative and PR-reviewable, so the original "reviewable in a PR like the allowlist" goal is preserved. The earlier one-off `--exclude <pattern>` flag on `list`/`load` was **removed** in the same release; one-off suppression is no longer a flag. Notice output is decoupled from warnings and can be quieted for automation via `--no-notices` (on `list`/`install`) or `INTENT_NO_NOTICES=1`. See §14 (entry retired).
- Hard invariant: never `await import()` user package code. Add a code-comment invariant and an ESLint `no-restricted-syntax` rule prohibiting dynamic `import()` of computed paths inside `scanner.ts`, `lockfile.ts`, `manifest.ts`, and `mcp/`.
- PnP compatibility exception: scanner code may load package-manager resolution infrastructure (`.pnp.cjs` / `pnpapi`) only to map package identities to readable package roots. It must not load package entrypoints, bins, lifecycle scripts, framework configs, or other package-provided JavaScript.
- The `tanstack-intent` keyword is no longer required for consumer discovery. Still recommended for registry indexing.

### M2 — Lockfile + approve / diff / update + frozen mode

**Goal:** Make discovery reproducible and changes reviewable.

New file `intent.lock` (committed at consumer project root). V1 uses a single committed root `intent.lock` as the authoritative approval state and policy snapshot. It does not create a `.intent/` directory or committed audit log. Normal VCS history and deterministic lockfile diffs are the v1 audit mechanism.

```jsonc
{
  "lockfileVersion": 1,
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
      "contentHash": "sha256-...", // aggregate hash over normalized package-relative SKILL.md paths + LF-normalized bytes (D32)
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

**The lockfile carries no generation timestamp — it is fully deterministic (Resolved D33).** There is no `generatedAt`/`generatedOn` field: the same inputs (sources, versions, hashes, capabilities, policy) must serialize to a byte-identical `intent.lock`, so `approve`/`update` produce a clean diff with no churn line and no merge-conflict point on the security-critical file. This matches the M3 rule that manifest generation carries no timestamps, for the same reason — a per-write timestamp would noise the very diff that D4 designates as the v1 audit mechanism. "When was this approved?" is answered by `git blame`/commit history on the source's lines, which is per-source, attributed, and more trustworthy than a self-reported file-level date. If product UX ever demands an in-file answer, the right shape is a **per-source `approvedAt`** on the `sources[]` entry (a human-decision timestamp that only moves when that source is re-approved, consistent with M4 `rejectedAt` and M6 `createdAt`), not a file-level field — deferred for v1; the schema leaves room. The other timestamps in this file (`policy.ignores[].createdAt`/`expiresAt`) are human-decision records on specific entries, not per-write generation noise, so they do not reintroduce churn.

The lockfile does not store scanner read locations such as `node_modules/@scope/pkg`, `.pnpm/...`, or `.yarn/cache/*.zip/...`. The scanner may use those locations to read files during the current run, but lock comparison uses stable source identity plus package-relative paths.

`contentHash` uses the canonical hashing rules in §2. A package moved between `node_modules`, pnpm, Yarn PnP, and workspace sources must produce the same hash when its package-relative skill paths and bytes are identical.

**Identity matching tightens from name-only to `kind` + `id` here (closes the M1 F1 baseline).** M1 matches an allowlist entry against a discovered package by normalized name alone, because the scanner emits no workspace-membership signal and therefore cannot distinguish a `workspace:` member from a same-named npm dependency (see M1). M2 needs a precise key anyway — `intent.lock` `sources[]` are identified by `kind` + `id`, and approval/diff/frozen-mode comparisons must not collapse a workspace member and an npm package that share a name. So M2 adds the deferred workspace-membership signal to the scanner (F2) and promotes matching everywhere identity is compared (allowlist match, exclude match, lockfile lookup) to the full `kind` + `id` key. This narrows M1's permissive name-only behavior: after M2, `"workspace:foo"` authorizes only the workspace member `foo`, not an npm `foo` of the same name. The change is a deliberate tightening, called out in the v0→v1 migration notes so a project relying on the M1 looseness sees the diff surface on the next `scan`.

New shared modules: `lockfile.ts` (read/write/parse), `hash.ts` (sha256 helpers). New commands:

- `intent skills scan` — discover + compute current state + diff against lock. Read-only. Safe in all modes.
- `intent skills approve [source]` — write/update lock entries. No arg → prompts per source. `--all` → accepts everything pending. Single source id → updates only that one. Refuses to run in frozen mode.
- `intent skills diff` — human-readable diff of pending changes (added/removed sources, version bumps, content/manifest/capability/MCP-tool changes). Read-only.
- `intent skills update [source]` — re-resolve to latest installed version and re-approve. No arg → all sources. Refuses to run in frozen mode.

**Frozen mode:**

- Triggered by `--frozen`, `INTENT_FROZEN=1`, or auto-detected when `CI=true` and stdin is not a TTY (overridable with `--no-frozen`). Because these triggers are toggled by the workflow itself, frozen-mode guarantees assume the CI workflow file is review-protected (branch protection + CODEOWNERS on `.github/workflows/`); see §1 _Threat model_ — Intent cannot enforce this from inside.
- `scan` and `diff` still run — read-only and necessary to _detect_ drift.
- `approve` / `update` refuse to mutate `intent.lock`.
- Unlisted sources with `skills/` directories are a hard fail (M1 warning promoted).
- Lockfile mismatch (any pending diff) is a hard fail with non-zero exit and a one-screen summary.
- The committed `intent.lock` is authoritative in frozen mode. A future uncommitted overlay (`intent.local.json`, §15 P1) admits personal sources **locally only**: such sources are never written into the committed lock and are exempt from its drift check (so a local run does not flag them as drift), and they may not admit sources under `--frozen` — where the gitignored overlay is absent and only committed, team-reviewed trust applies. This pre-settles P1's interaction with M2 even before P1 ships.
- No outbound network: short-circuits `staleness.ts:fetchNpmVersion`.
- No arbitrary `execFileSync`/`execSync` against user-side tools (`gh`, package managers, project scripts, globally installed binaries, etc.). `feedback.ts:submitFeedback` is interactive-only and not invoked in CI today; the guard makes that explicit.
- Frozen mode exception: M7 may use an internal read-only Git adapter for local repository object inspection required by staleness checks. This adapter is not a general subprocess escape hatch. **"Read-only git" is not safe by subcommand — git has flags that execute external programs during a read, so the adapter must constrain the entire argv, not just the subcommand (D29).**
  - It may resolve local baseline refs and read local tree/blob object IDs.
  - It must pass arguments as `argv`, never through a shell. (argv-not-shell stops command substitution, but **not** flag injection — the constraints below are still required.)
  - It must use a fixed allowlist keyed on **subcommand _plus_ exact flag shape** — e.g. `rev-parse --verify`, `cat-file`, `ls-tree` — not the subcommand alone. Any flag not on the per-subcommand allowlist fails closed.
  - It must run git with a hardened, fixed leading environment that strips ambient config influence: set `GIT_CONFIG_NOSYSTEM=1`, ignore user/global `~/.gitconfig`, and neutralize repo-level `core.attributesFile` / `.gitattributes` influence on the invoked operations.
  - It must explicitly forbid the exec-bearing flags regardless of subcommand: `-c` (inline config, e.g. `core.pager` / `uploadpack.packObjectsHook`), `-C`, `--exec-path`, and `cat-file`'s `--textconv` / `--filters` (both run `.gitattributes`-configured programs — arbitrary exec on a _read_).
  - It must place a `--` separator before any ref/path-derived value (e.g. M7's `--baseline <ref>`), so a value beginning with `-` is parsed as a ref/path and never as a flag (argument injection).
  - It must not run `fetch`, `pull`, `push`, `checkout`, `switch`, `reset`, `merge`, `commit`, config mutation, hooks, package managers, credential prompts, or commands that contact remotes.
  - It must fail closed with a clear diagnostic if Git data cannot be read in frozen mode, or if any argument fails the allowlist/separator checks above.

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

**The `name` value is itself non-compliant (D22).** D20 above moves the non-spec _keys_ off the top level, but the `name` _value_ Intent emits — `routing/file-based` — is independently rejected by the spec: `name` may contain only lowercase alphanumerics and hyphens (a `/` is "invalid characters") and must equal the parent directory name (a multi-segment value cannot). This is the specific error reported in #116, #140, and `reduxjs/redux-toolkit#5303` (which copied Intent's slash pattern and is waiting on Intent to change). **Resolved D22:** `name` is the spec-legal leaf segment matching the parent directory (`file-based`); the namespace Intent previously packed into `name` (`routing/...`) is carried by the package-relative path, which is already Intent's canonical identity (lockfile id, `contentHash` sort key). The slash-`name` was a redundant second copy of an identity the path already guarantees; D22 deletes the copy and keeps the one the security model already treats as canonical. Skill names are therefore intentionally **non-unique** across a package; uniqueness is enforced on path, never on `name`. Lookup everywhere — lockfile, manifest, `load`, MCP `get_skill` — keys on the qualified path-based identity (e.g. `@tanstack/router#routing/file-based`), never the bare `name`.

v1 resolution — **manifest-first, no backward-compat shim** (v1 is already a breaking release; these fields are Intent-internal and read only by Intent):

- **Scalar Intent fields move under `metadata` as strings.** `type`, `library`, `library_version`, `framework` become `metadata.type`, `metadata.library`, `metadata.library_version`, `metadata.framework`. `library_version` stays machine-readable there for staleness Layer 1.
- **Array / structured fields move to the manifest, not frontmatter.** `sources` and `requires` are not representable in a string-only `metadata` map, so they live in `skills/intent.manifest.json` (the manifest is Intent's structured surface and is not bound by the frontmatter spec). `requires` load-order hints also remain available via `package.json#intent.requires`.
- **No serialized-string duplication in `metadata`.** Arrays are not stuffed into `metadata` as delimited strings — that would be permanent cruft the content hash must keep tracking. The manifest is the single structured source.
- **Migration:** existing skills with non-spec top-level keys are migrated by `generate-manifest`/a `validate --fix` path — scalars rewritten under `metadata`, arrays lifted into the manifest, and `name` rewritten to the parent-directory leaf (D22). Documented in `docs/migration/v0-to-v1.md`.

New file per skill package: `skills/intent.manifest.json` (ships with the package). V1 uses this package-level manifest as the canonical manifest surface. Per-skill manifest files such as `intent.skill.json` are not part of v1 and are rejected to avoid split-brain metadata.

```jsonc
{
  "manifestVersion": 1,
  "package": "@tanstack/router",
  "packageVersion": "1.42.0",
  "skills": [
    {
      "name": "file-based",
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

- `intent skills generate-manifest` — walks `skills/`, computes content hashes, runs static heuristics (regex scan for `curl|wget`, `npm i|pnpm add|yarn add|bun add|pip install`, `SECRET_PATTERNS` from the shared `secrets.ts` module, fenced code blocks containing `child_process`/`spawn`/`exec`), and emits a manifest pre-filled with the heuristic findings. The maintainer reviews the diff and commits. Static analysis **informs** the manifest; the maintainer has final say on declared capabilities. Content hashing normalizes line endings to LF before hashing (D32), so a manifest generated on a CRLF working tree matches the LF bytes shipped in the tarball and the `contentHash` a consumer computes.
- **`.gitattributes` recommendation (belt-and-suspenders for D32).** `scaffold` emits, and docs recommend, a `.gitattributes` pinning skill text to LF (e.g. `SKILL.md text eol=lf`, or `*.md text eol=lf`) so the working tree, validate environment, and published tarball already agree. This is complementary, not load-bearing: hash-time LF normalization (D32) guarantees correctness even when an author omits it.
- `intent skills validate` (replaces today's flat `intent validate`):
  - All existing SKILL.md format/length/frontmatter checks.
  - **Agent Skills–spec frontmatter compliance (D20): error (not warning) on any non-spec top-level key.** Only `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` are allowed at the top level; `metadata` must be a string→string map. Non-spec keys (`type`, `library`, `library_version`, `framework`, `sources`, `requires`, …) fail validation with a remediation pointer ("move scalars under `metadata`; move arrays to the manifest"). The `name` _value_ must also be spec-legal: lowercase alphanumerics and hyphens only, no `/`, equal to the parent directory leaf (D22) — a slash-namespaced `name` fails with a pointer to the leaf form. `validate --fix` performs the full migration (keys + `name`).
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
- **`generate-skill` meta-skill rewrite (D20 + D22):** its Step 3 frontmatter templates emit the spec-compliant shape — spec keys at top level, Intent scalars under `metadata`, no top-level `type`/`library`/`library_version`/`framework`/`sources`. `name` is emitted as the spec-legal leaf matching the parent directory (D22), not the slash-namespaced form. Structured data (including the per-skill `requires` graph, keyed by qualified path identity) is written to the manifest via `generate-manifest`, not the frontmatter.

**Touches:** new `manifest.ts`, new `secrets.ts` (move + add patterns), new `commands/skills-generate-manifest.ts`, refactor `commands/validate.ts` → `commands/skills-validate.ts` (add spec-key enforcement + `--fix`), `packages/intent/meta/generate-skill/SKILL.md` (compliant frontmatter templates), types.

### M4 — Capability/secret/download metadata wired through lockfile

**Goal:** Make approval and diff capability-aware.

> **Disclosure, not enforcement (D28).** Declared capabilities are maintainer **disclosures**, not limits Intent enforces. Intent never executes a skill and is not in the agent's tool-call path, so it has no point at which to block a declared (or undeclared) behavior; the static heuristics that cross-check declarations only **warn** (M3) and are regex-over-markdown (evadable by encoding or indirection). Their only teeth are **change-detection**: a shift in the declared set re-surfaces the source for human review. Render the diff and prompt in those terms — "this source now _declares_ network access; review it" — never as "Intent will prevent network access." A consumer must not read an approved capability set as a sandbox.

- Capability deltas become first-class diff entries. A version bump that adds `uses_network` requires re-approval; a content-only change that doesn't shift capabilities still requires approval but is rendered as low-risk.
- Approval prompt copy (draft):

  ```
  @tanstack/router v1.42.0 → v1.43.0
    + adds capability: uses_network
    + adds MCP tool: search_routes — will be disclosed to the agent (Intent does not run it)
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

- `get_skill(name)` — returns the full `SKILL.md` body for one approved skill. **Its description is generated at server start from the approved lockfile** and embeds the catalog when the catalog fits within configured size limits: each approved skill's qualified identity + one-line description + capabilities summary. The agent picks an entry directly from the description; no separate discovery call. The description is rebuilt whenever the lockfile is reloaded (start / SIGHUP).
  - **The lookup key is the qualified path-based identity, not the bare spec `name` (D22).** Because leaf names are intentionally non-unique (D22), the `get_skill` argument and the embedded catalog key on the qualified identity Intent already uses in the lockfile (e.g. `@tanstack/router#routing/file-based`). The catalog may also render the leaf `name` and its namespace for readability, but the selectable key is unambiguous. `intent load <use>` resolves the same way: a bare leaf is accepted only when it resolves to exactly one skill, otherwise it returns a disambiguation error listing the qualified candidates.

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
  "@tanstack/router#skills/routing/file-based/SKILL.md:search_routes": "surface",
  "@tanstack/router#skills/routing/file-based/SKILL.md:delete_route": "hide"
}
```

The values are **`surface`/`hide`**, deliberately not `allow`/`deny` (D34): `allow`/`deny` is the vocabulary of execution authorization (firewalls, IAM) and would invite a consumer to read `"delete_route": "allow"` as "I granted this tool permission to run" — the exact inverted mental model to avoid. `surface` means the tool's **metadata is disclosed** to the agent in the MCP catalog (`get_skill` description / `list_skills` / `search_skills`); `hide` withholds it. **Neither value executes anything** — Intent cannot run an `mcpTools[]` entry; if the tool is real it lives in the library and runs through the agent's own MCP wiring, entirely outside Intent. The field name stays `mcpPolicy`. V1 supports only `surface` and `hide`; `allow`/`deny`/`prompt` and any other value are invalid and fail closed (a stale `allow`/`deny` from an older draft is rejected, not silently coerced). Lock-mismatch restrictions are absolute and cannot be overridden by policy.

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
- Every entry in `mcpTools[]` has an explicit `mcpPolicy` (`surface` or `hide`; no implicit surface-by-omission). (warning)
- In maintainer projects (`@tanstack/intent` in `devDependencies`): the dependency uses an exact version, not a range. (info)
- In consumer projects with a lockfile: `@tanstack/intent` is also in `devDependencies` (warns against `npx`-only lock-driven workflows). (warning)

Exit code: non-zero if any `error`-level issue is present.

Security-doctor suppressions live in the top-level `intent.lock#policy.ignores[]` section. Lock entries describe observed source state; `policy.ignores[]` describes human risk acceptance. V1 does not allow inline policy fields inside source identity/hash entries.

Each ignore entry requires:

- `id` — stable security-doctor issue id or fingerprint.
- `scope` — the source, package, file, observed hash, or finding scope the ignore applies to.
- `reason` — human-readable justification.
- `createdAt` — full ISO 8601 datetime (e.g. `2026-05-26T14:30:00Z`) for audit.

Each ignore entry should include `expiresAt`. If `expiresAt` is missing, `intent security doctor` still suppresses the matching finding but reports the non-expiring ignore in a suppressed/ignored summary. Expired ignores do not suppress findings.

**Timestamp format and expiry comparison (D36).** `expiresAt` accepts either a full ISO 8601 datetime (e.g. `2026-08-26T17:00:00Z`) or a bare calendar date (`YYYY-MM-DD`); the bare form is allowed because these entries are hand-authored. All expiry comparison is performed in **UTC**, never the runner's local timezone, so two machines in different zones never disagree on whether an ignore is still valid. A **bare date expires at end-of-day UTC** — `2026-08-26` is treated as `2026-08-26T23:59:59.999Z`, so a hand-written expiry stays valid through the whole of that calendar day everywhere; a full datetime is compared as written. An ignore is expired when the current UTC instant is **at or after** the resolved expiry instant. A malformed `expiresAt` (neither form) fails validation rather than being treated as non-expiring. `createdAt` is informational (audit only) and is not used in the expiry comparison.

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

In frozen mode, Layer 2 may use only the read-only Git adapter described in M2. If Git is unavailable, the project is not a Git repo, or the baseline ref cannot be resolved from local data, `intent skills stale --frozen` fails with a distinct diagnostic. It must not silently skip Layer 2 or fetch missing refs. Diagnostics say "no local reachable tag found" or "baseline ref is not available locally" rather than claiming the repository has no tags. The adapter's argv-hardening rules (subcommand-plus-flag allowlist, `GIT_CONFIG_NOSYSTEM=1`, forbidden `-c`/`-C`/`--exec-path`/`--textconv`/`--filters`, and a `--` separator before the `--baseline` ref) are normative here — see M2's frozen-mode adapter spec (D29). The user-supplied `--baseline <ref>` value in particular must pass through the `--`-separated, allowlisted path; it is never interpolated into a git flag position.

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
intent exclude [list|add|remove]  # manage package.json#intent.exclude (shipped 0.1.0)
intent skills add|remove|list     # manage package.json#intent.skills allowlist (D24, post-M1)
intent skills init                # bootstrap intent.skills from discovered packages (§15 P2)
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
- **`intent exclude` is intentionally flat, not `intent skills exclude` (shipped `0.1.0`).** It manages a cross-cutting `package.json#intent.exclude[]` filter that applies to every consumer surface (`list`, `load`, `install`, discovery, and the future lockfile/MCP paths), not to a single `skills` sub-domain — so under D7 it qualifies as a top-level cross-domain action rather than a `skills` verb. This is the one deliberate exception to "no new flat commands"; it is not an alias for a nested command.
- **The additive allowlist editor is `intent skills add` / `remove` / `list`, not a flat `intent add` (Resolved D24).** Both editor commands follow one rule — _name the command after the config array it edits_. `intent exclude` edits `intent.exclude`; the allowlist editor edits `intent.skills`, so it is spelled `intent skills add`/`remove`/`list`. That yields the same `add`/`remove`/`list` action family as `intent exclude` (the symmetry P2 wants) while keeping the allowlist editor in the `skills` domain per D7 — the flat-vs-nested spelling difference is purely an artifact of the keys being named `exclude` vs `skills`, not a model inconsistency. A bare `intent add` is rejected: it breaks the name-after-the-array rule and is ambiguous ("add what?", reads like a package-manager dependency add). The lifecycle verbs (`scan`/`approve`/`diff`/`update`) and the allowlist-editor verbs (`add`/`remove`/`list`/`init`) coexist under `skills` because both are skills management.
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

- **M1:** unit tests in `tests/scanner.test.ts` covering the allowlist matrix (listed/found, listed/missing, unlisted/found, name-only matching across `npm` and `workspace:` kinds — including the same-name collision where `workspace:foo` authorizes an npm-discovered `foo` (the F1 permissive baseline, see M1), transitive skill package not trusted unless listed). Exclusion tests assert suppressed skills are unavailable for discovery, generated indexes, MCP exposure, skill lookup, capability prompts, and invocation. Integration test confirming a fresh project with no `intent.skills[]` emits the migration warning exactly once.
- **M2:** fixture-driven lockfile round-trip tests (parse → write → parse byte-identical). Tests assert commands write only root `intent.lock`, do not create `.intent/`, preserve top-level policy/rejection/staleness sections, and produce deterministic ordering across regenerations. Identity-tightening tests assert the F2 scanner membership signal lets `kind` + `id` matching distinguish a `workspace:foo` member from an npm `foo` of the same name (the case M1 deliberately collapsed), across allowlist match, exclude match, and lockfile lookup. Frozen-mode integration tests assert non-zero exit on each drift category. First-run test: no lockfile → `scan` reports missing, `approve --all` creates it.
- **M3:** manifest schema validation tests. `generate-manifest` golden-file tests over representative SKILL.md fixtures assert deterministic ordering/formatting, stable output across repeated runs, invalid path rejection, duplicate path/id rejection, missing/extra `SKILL.md` detection, per-skill manifest rejection, MCP-compatible `mcpTools[]` metadata validation, runtime-field rejection, and move/rename behavior. Round-trip with `scan` (manifest → lockfile manifestHash). **D20 spec-compliance tests:** `validate` errors on each non-spec top-level key (`type`, `library`, `library_version`, `framework`, `sources`, `requires`), accepts the six spec keys, rejects non-string `metadata` values; `validate --fix` migrates a non-compliant fixture to scalars-under-`metadata` + arrays-in-manifest; `generate-skill` output validates clean against the spec.
- **M4:** diff-rendering snapshot tests for each capability/MCP/version-change category. Rejection tests assert the same source identity + same observed hashes stays suppressed, while source identity, version, content, manifest, or capability changes re-surface a previously rejected source.
- **M5:** MCP server tested via the SDK's in-memory transport — `list_skills`, `get_skill`, `get_diff` over fixture lockfiles, including the lockfile-mismatch error path. Tool-shape tests assert small catalogs expose `get_skill` with the full embedded catalog, large or verbose catalogs expose `get_skill` with a compact summary plus `list_skills` / `search_skills`, and fallback tools augment rather than replace `get_skill`. Launch-path tests assert local project/workspace installs can serve MCP, while `npx`/`dlx`/global/ephemeral invocations fail for `mcp serve` but remain allowed for one-off `list`/`install`. `mcpTools[]` tests assert metadata is surfaced only after policy approval, tool identities are fully scoped, duplicate bare names do not collide, `prompt` and unknown policy values fail closed, and no imports, subprocesses, or MCP connections occur. Lock mismatch tests assert `get_lock`/`get_diff` remain callable while skill-serving/catalog tools fail. Author-mode tests assert `--author` without `intent.lock` serves only bundled meta-skills, does not serve workspace/consumer skills, and cannot be shadowed by local files.
- **M6:** doctor tests assert correct issue classification (error/warning/info) for each check. Ignore-policy tests assert matching `policy.ignores[]` entries suppress only matching issue/scope pairs, changed source hashes re-surface findings, expired ignores do not suppress findings, non-expiring ignores appear in the suppressed summary, and inline ignore markers in source entries are rejected. Expiry tests assert bare-date `expiresAt` resolves to end-of-day UTC, comparison is UTC-not-local (a date is valid through its whole day regardless of runner timezone), at-or-after the resolved instant is expired, and a malformed `expiresAt` fails validation rather than never-expiring (D36).
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

| ID  | Question                                                                               | Resolution                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --- |
| D1  | Remove `intent-library` bin+sources now vs deprecate                                   | Remove now as a v1 breaking cleanup. No compatibility shim.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| D2  | Sources in `package.json#intent.skills` vs `intent.config.json`?                       | Use `package.json#intent.skills[]`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| D3  | Drop `bin.intent` legacy fallback in `isIntentPackage`?                                | Yes. Removed with the abandoned `library-scanner.ts` path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D4  | Single `intent.lock` vs `.intent/` folder                                              | Single committed root `intent.lock`. VCS history and deterministic diffs are the audit mechanism.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| D5  | Package-level vs per-skill manifest                                                    | Package-level `skills/intent.manifest.json`. Per-skill manifests are rejected in v1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| D6  | MCP transport: stdio only vs stdio + HTTP/SSE                                          | Stdio only in v1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| D7  | Flat vs nested CLI verbs                                                               | Nested domain commands are canonical. No new flat aliases.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| D8  | What does an unlisted source do in M1?                                                 | Warn in M1. Hard fail in M2 frozen mode.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| D9  | Per-skill approvals                                                                    | Out of v1. Approvals are source/package-scoped; individual skills can be excluded.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| D10 | Publish `@tanstack/intent-types`                                                       | Not in v1. Public types are exported from `@tanstack/intent`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| D11 | `intent mcp serve` via `npx` vs local dependency                                       | Local project/workspace install only. `npx` remains for one-off `list` / `install`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| D12 | `mcpTools[]` metadata vs runtime implementation shape                                  | Metadata only in v1. Runtime fields are invalid; future runtime support needs a new versioned shape.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| D13 | Interactive `prompt` MCP policy                                                        | Out of v1. Valid `mcpPolicy` values are `surface` and `hide` (D34 — renamed from the earlier `allow`/`deny` to avoid an execution-authorization reading); `prompt` and unknown values fail closed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |     |
| D14 | Rename `intent install`                                                                | Keep the name in v1. Add configurable guidance commands for managed agent guidance.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| D15 | MCP tool shape and fallback threshold                                                  | `get_skill` is primary. Embed full catalog below threshold; above threshold use compact summary plus `list_skills` / `search_skills`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| D17 | Default baseline ref for Layer 2 staleness                                             | `--baseline`, then lockfile baseline, then nearest local tag. No implicit `HEAD~1` fallback.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| D18 | M7 in v1 vs fast-follow                                                                | Split. Part B (layered staleness) ships in v1 as a maintainer-reliability commitment, prioritized with M3 ahead of M4–M6. Part A (agent surface) is the minimal cut candidate — rides on M5, fast-follows if the core runs hot. Both keep the hard local/read-only/no-network gates.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| D19 | Standalone/personal skills as a generic installer vs a pinned source kind              | Pinned source kind (`kind: git`), not a generic installer. Reserved in M1 (parse-and-reject), implemented post-M2 once the lockfile can pin the ref + content hash. Materialized into a gitignored managed dir; identified by the pinned ref, never the path. Unpinned hand-dropped local dirs stay out of scope (§14).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| D20 | Agent Skills frontmatter compliance (#116, #140)                                       | Enforce spec compliance in M3. Only the six spec keys at top level; Intent scalars move under `metadata`; arrays (`sources`, `requires`) move to the manifest. `validate` errors on non-spec keys with a `--fix` migration. No backward-compat shim.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| D21 | `intent.skills[]` absent vs empty `[]` vs wildcard `["*"]`; can `"*"` mix?             | Absent → show-all + one-time deprecation warning (v0 upgrade path; **time-boxed to 0.x — flips to deny-all at 1.0, see D30**). Empty `[]` → deny-all + quiet info note (never collapsed with absent). `["*"]` → permit-all-discovered + loud acknowledged-risk notice. `"*"` composes **additively** with `git:` entries (`["*", "git:…"]` = all discovered **plus** curated repos) — the inevitable end state; redundant npm/workspace entries alongside `"*"` are subsumed, not errors. Git stays parse-and-reject in M1 (D19), so `"*"` + `git:` fails the whole list until M2 materialization lands.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| D22 | Skill `name` value: slash-namespaced vs spec-legal leaf?                               | Spec-legal leaf matching the parent directory; the namespace moves to the package-relative path, which is already Intent's canonical identity (lockfile id, `contentHash` sort key). Closes the gap D20 left (D20 fixed non-spec _keys_; the `name` _value_ slash is independently spec-illegal and is the reported error in #116/#140/`redux-toolkit#5303`). `get_skill` / `load` / lockfile key on the qualified path-based identity, never the bare `name`; leaf names are intentionally non-unique, uniqueness is enforced on path. `validate --fix` rewrites `name` to the leaf in the same pass as D20. Extends D20; no backward-compat shim beyond a deprecation-window reader.                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| D23 | Dedicated `intent exclude` command vs hand-edited excludes (reverses the §14 deferral) | **Ship the command.** `0.1.0` (#157) adds a flat `intent exclude` with `add`/`remove`/`list` that reads/writes `package.json#intent.exclude[]` in place. Reverses the original "no exclude command in v1" plan (then in §14): the `add`/`remove`/`list` family is the goal, giving excludes a managed surface symmetric with the planned additive allowlist-management command (§15 P2). The written `exclude[]` stays declarative and PR-reviewable, preserving the original review-in-PR property. The one-off `--exclude` flag on `list`/`load` is **removed** in the same release. `intent exclude` is intentionally flat (a cross-cutting filter, not a `skills` sub-verb — see §6). Notices decoupled from warnings, quietable via `--no-notices` / `INTENT_NO_NOTICES=1`. Updates §3, M1, §6; retires the §14 entry.                                                                                                                                                                                                                                                                                                                                       |
| D24 | Additive allowlist editor: nested `intent skills add` vs flat `intent add`?            | **Nested `intent skills add` / `remove` / `list`** (plus `intent skills init` for the P2 bootstrap). One rule governs both editor commands — _name the command after the config array it edits_: `intent exclude` edits `intent.exclude` (flat, a cross-cutting filter per D23/§6), and the allowlist editor edits `intent.skills`, so it is spelled `intent skills add`/`remove`/`list`. This keeps the exclude-symmetric `add`/`remove`/`list` action family while landing the allowlist editor in the `skills` domain per D7; the flat-vs-nested spelling gap is just an artifact of the keys being named `exclude` vs `skills`, not a model inconsistency. A bare `intent add` is rejected — it breaks the name-after-the-array rule and is ambiguous (reads like a package-manager dependency add). New step it introduces: `intent skills add` is the first writer of `intent.skills` (still read-only today), a real trust-model change. Resolves the §6 open sub-question; updates §15 P2 option 1. Implementation deferred (post-M1, alongside P2).                                                                                                      |
| D25 | Personal/uncommitted source overlay: add one, and how? (§15 P1)                        | **Adopt option 1 — `intent.local.json`, gitignored by convention, merged last (most-local-wins), additive/allow-only.** Mirrors `.env.local`; reuses the existing `core/excludes.ts` `getConfigDirs` merge path (cwd → workspace-root), keeps the committed `package.json#intent.skills` allowlist reviewable, and composes with the reserved `git:` kind (D19). Rejected: user-level `~/.config/intent/config.json` (a follow-on, not a substitute — may layer later), env var `INTENT_SKILLS_EXTRA` (unreviewable trust surface), and a separate committed `intent.config.json` (reopens D2). **Security constraint (binding):** the overlay is allow-only — it can _add_ sources but can **never** suppress a committed `exclude` or admit sources under `--frozen` (where the gitignored overlay is absent and only committed, team-reviewed trust applies). Its M2 interaction is already pre-settled in M2's frozen-mode rules (never written to `intent.lock`, exempt from the committed-lock drift check, inert under `--frozen`). Implementation deferred to an independent fast-follow after M2 (“M2.5”); not bundled into M2 (zero lockfile coupling). |
| D26 | Allowlist bootstrap command (§15 P2)                                                   | **Ship both editor surfaces:** `intent skills add`/`remove`/`list` for incremental management (per D24) **and** `intent skills init` to bootstrap `intent.skills` from currently-discovered packages. `init` is the consumer-side analog of M2's `intent skills approve --all`. **Security constraint (binding):** `init` must be **interactive and reviewable** — it shows the discovered list and requires confirmation; it never silently allow-alls (that is what `["*"]` is for, with its acknowledged-risk banner). Both are out of M1 (the allowlist shipped read-only); implementation lands post-M1, with the polished two-step first run (`init` → `approve --all`) completing around M5 per §7. Not bundled into M2 — `init` is a distinct allowlist-writer (trust-model) change, not lockfile plumbing; the clean seam if later paired is `init` writes `intent.skills`, then hands off to the existing `approve --all`.                                                                                                                                                                                                                              |
| D27 | Should the RFC state the threat-model scope explicitly?                                | **Yes — state it plainly (§1 _Threat model_).** Intent's machinery secures bytes and change, not meaning: in scope = supply-chain integrity, source gating, change disclosure, reproducibility/frozen-mode; out of scope = adversarial skill _prose_, maintainer trustworthiness, and declared-capability honesty, all of which rely on the human reviewer at `approve`. "Approved" means "a human reviewed this exact change," never "Intent verified this is safe." Docs (`docs/security/trust-model.md`), the `approve` prompt, and the M4 capability UX must use that meaning and must not imply content vetting; secret-scanning is defense-in-depth for literal secret values, not a content-safety check. Content-level defenses (signing, injection analysis, sandboxing) stay deferred (§14). Stating this is deliberate honesty so the human-review step stays legible rather than a rubber stamp.                                                                                                                                                                                                                                                      |
| D28 | Are declared capabilities enforcement or disclosure?                                   | **Disclosure + change-detection, never enforcement — and the doc must stop calling it "gating."** Capabilities/`declaredSecrets`/`mcpTools[]` are maintainer-declared labels; Intent never executes the skill and has no enforcement point, and the M3 heuristics that cross-check them only warn (regex-over-markdown, evadable). The term stays "capability" (familiar; matches the `capabilities[]` field), but every "gating / enforce / approve-at-granularity / sandbox" implication is stripped: §1 item 4 is now "Capability **disclosure**" and M4 carries an explicit disclosure-not-enforcement note. The machinery is retained — its real value is re-prompting on a declared-capability change. A consumer must not read an approved capability set as a limit on what the skill's prose can instruct.                                                                                                                                                                                                                                                                                                                                               |
| D29 | How is the frozen-mode read-only git adapter constrained?                              | **Constrain the whole argv, not just the subcommand.** "Read-only git" is not safe by subcommand: `-c` (inline config like `core.pager`/`uploadpack.packObjectsHook`), `--exec-path`, and `cat-file --textconv`/`--filters` all run external programs _during a read_, and a `-`-leading ref/path is parsed as a flag (argument injection) — an RCE shape in the mode sold as fail-closed. The M2 adapter spec is hardened to: a fixed allowlist keyed on **subcommand + exact flag shape** (not subcommand alone); a fixed leading env (`GIT_CONFIG_NOSYSTEM=1`, ignore `~/.gitconfig`, neutralize repo `core.attributesFile`/`.gitattributes`); explicit denial of `-c`/`-C`/`--exec-path`/`--textconv`/`--filters` regardless of subcommand; a mandatory `--` separator before any ref/path-derived value (notably M7's `--baseline <ref>`); argv-never-shell; and fail-closed on any non-matching argument. M7 Part B references this spec normatively. Folds in the former note N3 (name `--textconv`/`--filters` explicitly).                                                                                                                               |
| D30 | When does the absent-state default flip from show-all to deny-all?                     | **At 1.0 — keep it inside the v1 train, not deferred to a future major.** v1 is already a breaking release, so there is no silent v0→v1 migration to protect: the `absent → show-all` state is a **deprecated-but-live** upgrade path through the 0.x line (one-time deprecation warning naming the flip), and at **1.0 the absent default becomes deny-all** — a project with no `intent.skills[]` surfaces nothing until it opts in. Clean semver story: **0.x = warn, 1.0 = enforce.** This is what makes the M1 allowlist the _sole_ gate (closes the open end of the M1 goal and the D21 "not a steady state" note); empty `[]` and absent stay distinct (both deny at 1.0, but absent still carries the migration framing until then).                                                                                                                                                                                                                                                                                                                                                                                                                      |
| D31 | Is the Yarn PnP exec exception justified, and is its trust boundary guarded?           | **Justified, and the boundary is documented — with a deferred code guard (§2 _Static discovery boundary_).** Executing the root-or-ancestor `.pnp.cjs`/`pnpapi` is acceptable because it is the same runtime the project's own `node` already loads (no new privilege); the trust argument holds only there, never for a package-supplied/down-tree PnP file. Code verified safe on `main` (`scanner.ts:loadPnpApi(projectRoot)` + upward-only `findPnpFile`) — the property is currently **emergent, not asserted**, so there is no bug but also no guard. RFC now states the justification and the root-or-ancestor-never-down-tree invariant; the asserting guard + test is a **defense-in-depth follow-up bundled into the M1/M2 static-discovery-invariant hardening** (or the next `scanner.ts` change), explicitly not urgent and not its own PR.                                                                                                                                                                                                                                                                                                          |
| D32 | Does `contentHash` hash exact bytes including line endings, or normalize?              | **Normalize line endings to LF before hashing (§2 _Canonical content hashing_).** `\r\n` and lone `\r` → `\n`; no other normalization (whitespace, Unicode, encoding all still byte-significant). Reverses the earlier "exact bytes including line endings" stance, which created a phantom-drift failure class at the author boundary — `generate-manifest` hashing a CRLF working tree (Windows `core.autocrlf`) vs the LF bytes shipped in the tarball, so the baked `manifestHash` would not match the consumer-computed `contentHash`, with no real content change and the failure landing on library authors. CRLF-vs-LF is not a security signal, so collapsing it costs no integrity while making the same `SKILL.md` hash identically across OS/package-manager/author→consume. M3 adds a `.gitattributes` (`SKILL.md text eol=lf`) recommendation as belt-and-suspenders, but hash-time normalization is what guarantees correctness when an author forgets it.                                                                                                                                                                                         |
| D33 | Keep `generatedAt` in `intent.lock`, or drop it for a deterministic file?              | **Drop it — no generation timestamp; the lockfile is fully deterministic (M2 schema).** A per-write `generatedAt` would churn the one file whose clean diff D4 designates as the audit mechanism, and contradicts the M3 "no generated timestamps" rule for the same reason. Same inputs → byte-identical `intent.lock`. "When was this approved?" is answered by `git blame`/commit history (per-source, attributed, more trustworthy than a self-reported field) — lockfiles (`package-lock`, `pnpm-lock`, `Cargo.lock`) carry no such field and are reviewed via diff/blame, not opened to read a date. If in-file timestamping is ever wanted, the right shape is a per-source `approvedAt` (human-decision, moves only on re-approval; consistent with M4 `rejectedAt`, M6 `createdAt`), deferred for v1 with schema room. Open follow-up: confirm at M2 build that `scan`/`diff`/frozen comparison is semantic (per-entry), not whole-file byte-wise — inferred, not yet verified.                                                                                                                                                                          |
| D34 | `mcpPolicy` values: `allow`/`deny` vs surfacing terms?                                 | **Rename to `surface`/`hide` (M5); field name stays `mcpPolicy`.** `mcpPolicy` governs whether an `mcpTools[]` entry's **metadata is disclosed** to the agent in the MCP catalog — never execution (Intent cannot run these tools; a real one runs through the agent's own MCP wiring, outside Intent). `allow`/`deny` imports an execution-authorization mental model (firewall/IAM) that is exactly backwards here, inviting a consumer to read `"delete_route": "allow"` as "granted permission to run." `surface` = disclosed; `hide` = withheld. v1 accepts only `surface`/`hide`; `allow`/`deny`/`prompt` and any other value fail closed (a stale `allow`/`deny` is rejected, not coerced). The M4 prompt copy is reworded to "will be disclosed to the agent (Intent does not run it)" instead of "(side-effecting)." Same disclosure-not-enforcement reframe as D28, applied to the MCP surface.                                                                                                                                                                                                                                                         |
| D35 | Is the `["*"]` permit-all risk banner suppressible?                                    | **No — it is warning-level and non-suppressible.** The acknowledged-risk banner for `intent.skills: ["*"]` must emit on the warning channel and must not be silenced by `--no-notices` / `INTENT_NO_NOTICES=1`; a permit-all risk acknowledgment a CI run can quietly mute is not a safeguard. `--no-notices` may still hush informational notices (the absent-state migration hint, the empty-list note, unlisted-source hints), but never this banner. **Verified bug in shipped `0.1.0`:** `applySourcePolicy` pushes `ALLOW_ALL_NOTICE` into the same `notices` array that `printNotices` short-circuits under suppression, so the banner is currently silenceable. Fix = route the permit-all banner through the non-suppressible `printWarnings` channel (the separate, unsuppressed path already exists) + a test. RFC wording corrected now; the code fix is a tracked **v1 cleanup**, not urgent (no security boundary depends on it — M2 frozen mode independently hard-fails on unlisted/permit-all drift), parked in repo follow-ups.                                                                                                                 |
| D36 | `policy.ignores[]` timestamp format and expiry semantics?                              | **`expiresAt` accepts a full ISO 8601 datetime or a bare `YYYY-MM-DD`; compare in UTC; a bare date expires end-of-day UTC (M6).** Bare dates are allowed because entries are hand-authored; comparing in UTC (never runner-local time) stops two machines in different zones disagreeing on validity; end-of-day (`2026-08-26` → `2026-08-26T23:59:59.999Z`) matches the human reading "valid through Aug 26" rather than dying at midnight. Expired = current UTC instant at-or-after the resolved expiry; a malformed `expiresAt` fails validation rather than silently never-expiring. `createdAt` is a full ISO 8601 datetime, audit-only, not used in the comparison. Resolves the mixed-format/undefined-timezone gap in the M2 example + M6 spec.                                                                                                                                                                                                                                                                                                                                                                                                          |

## 14. Out of scope for v1

- Skill signing / provenance (sigstore-style). Future hardening.
- A general package-manager vulnerability scanner — Intent flags lifecycle scripts on _skill packages only_.
- Storing or rotating secret values. Intent only records declared _names_.
- Approval UI beyond a terminal prompt.
- Cross-language MCP tool sandboxing.
- Transitive skill trust. Consumers approve each skill-bearing source explicitly in v1. A listed package does not authorize skills in its dependencies.
- Transitive parent-chain context in the unlisted-source warning. M1's warning for a discovered-but-unlisted package is **flat** — it names the package, not the dependency path that pulled it in (`pkg-a → pkg-b`). Showing the chain needs parent-edge data the `ScanResult` does not carry today; adding it is a scanner change deferred to a later milestone. The opt-in decision is unaffected (the package name is enough to allow or exclude it); only the diagnostic breadcrumb is deferred.
- **Unpinned** local-directory skill sources — `file:` paths, `~/` personal skill collections, or any arbitrary hand-dropped local directory the scanner would trust by presence alone. Intent's goal is library knowledge distribution as _pinned, versioned_ sources; an unpinned drop-zone re-opens the over-permissive trust default M1 closes. Skills a developer wants to add by hand with no pinning stay in a personal/global skills directory, outside Intent — the developer's own responsibility, not an Intent source kind. **Note:** a _pinned_ standalone curated source (`kind: git`, reserved — §2, D19) is the in-model way to bring a personal/curated skills repo under Intent's lockfile; it is deferred to post-M2, not rejected. The line is pinning, not "npm package vs not."
- ~~A dedicated config-mutation command for excludes (`intent skills exclude …`).~~ **Retired — shipped in `0.1.0` (#157) as the flat `intent exclude` command.** This was originally deferred on the reasoning that excludes are low-frequency, set-once, and trivial to hand-edit as declarative JSON, so a command added a second write target and pressure to ship a matching `add`/`remove` family. That tradeoff was deliberately reversed: the `add`/`remove`/`list` family is the point — it gives excludes a managed surface symmetric with the planned additive allowlist-management command (§15 P2). The written `package.json#intent.exclude[]` stays declarative and PR-reviewable, so the original review-in-PR property is kept. See §3 and M1.
- Webhook-driven staleness detection. Webhook payloads are attacker-influenceable (forged webhooks can trigger false update PRs or suppress real ones). v1 staleness is pull-based and local (M7 Part B). Cross-repo TanStack-internal workflows can keep their own out-of-package scripts.
- Semantic-anchor staleness (Layer 3 in M7's layered model). Coupling skills to API symbols for symbol-level drift detection is the highest-precision approach but the heaviest to build and adds attack surface to the detector itself. v1 ships Layers 0–2; Layer 3 tracked for a future release.
- Tightening skill content to the non-derivable layer. A reviewer observed that generated skills often restate API surface — signatures, type definitions, exhaustive option lists — that an agent can already scan directly from a library's published `.d.ts` and source. That restatement adds no agent knowledge and is exactly the content that drifts on every API change, inflating M7's Layer 1–2 staleness signal. The principle: skills should capture what a type scan cannot derive — which API to reach for, the parameter and option interactions that matter, ordering and lifecycle invariants, and failure modes — not transcribe the surface itself. A future pass sharpens the `generate-skill` meta-skill's extract / don't-extract guidance and its validation checklist around this, which also shrinks the surface a future Layer 3 would have to track. This is authoring guidance, not a security boundary, so it sits outside the v1 security core.
- Telemetry. Intent does not phone home in v1.

## 15. Proposed additions — consumer allowlist ergonomics (resolved)

Both proposals below are now **resolved** (P1 → D25, P2 → D26) and recorded in the §13
decision table. Each remains **out of the M1 security core** (M1 shipped a read-only
`package.json#intent.skills` allowlist) and is **deferred in implementation** — P1 to an
independent fast-follow after M2 (“M2.5”), P2 to post-M1 with the polished first run
completing around M5 (§7). The problem statements, option analysis, and binding security
constraints are retained below as the rationale behind D25/D26.

### P1 — Config layering / personal source overlay

**Resolved (D25): adopt option 1 — a gitignored `intent.local.json`, merged last, additive/allow-only.**

**Problem.** A consumer's work repo can have a committed `package.json#intent.skills` allowlist,
but a developer may want to add their own personal skills repo locally **without committing it**
to the shared repo. Today there is no uncommitted layer: the allowlist is hand-authored in
`package.json#intent.skills` and merged cwd → workspace-root, and everything is committed.
This is a real unmet need and the same shape as the `git:` personal-repo use case (D21's
`["*", "git:…"]` composition).

**Options considered (chosen: 1):**

1. **`intent.local.json` (gitignored by convention), merged last / most-local-wins, additive.**
   Mirrors `.env.local`. Reuses the existing merge machinery, keeps the committed allowlist
   reviewable, and composes with the planned `git:` source kind. Does **not** reopen D2 — it is
   a local _overlay_, not a replacement home for the committed allowlist.
2. User-level config `~/.config/intent/config.json` for cross-repo personal defaults — a nice
   follow-on to option 1, not a substitute.
3. Env var `INTENT_SKILLS_EXTRA` — cheapest but unreviewable; weak for a trust surface. Avoid.
4. A separate committed `intent.config.json` — reopens D2 (the RFC chose `package.json#intent`).
   Avoid.

**Security constraint.** A personal / uncommitted overlay must be **allow-only**: it can _add_
sources, but it can **never suppress a committed exclude**. An uncommitted layer must not weaken
team-reviewed trust decisions.

**Scope.** Out of M1; resolved as D25. A trust-model decision intersecting D2 and D21, settled
here as one section rather than improvised in code.

**M2-bundling decision (resolved 2026-06-13): not bundled into M2.** P1 has zero coupling to the
lockfile — it plugs into the existing allowlist merge path (`core/excludes.ts` `getConfigDirs`,
cwd → workspace-root), not `lockfile.ts` / `hash.ts` / frozen mode. M2 depends on nothing in P1
and vice versa, so folding it in only widens M2's blast radius. P1's interaction with M2 is
bounded and **already pre-settled in M2's frozen-mode rules**: an overlay source is admitted and
loaded **locally** like any other allowlisted source, but because it is uncommitted it is (a) never
written into the committed `intent.lock` by `approve`, (b) exempt from the committed-lock drift
check in `scan` / `diff` so a local run does not flag it, and (c) unable to admit sources under
`--frozen`, where the gitignored overlay is absent and only committed trust applies. Target: an
independent fast-follow after M2 (“M2.5”), not part of M2.

### P2 — Allowlist bootstrap / `skills init` ergonomics gap

**Resolved (D26): ship both `intent skills add`/`remove`/`list` (D24) and an interactive `intent skills init` bootstrap.**

**Problem.** Nothing populates `intent.skills` from currently-installed discovered packages. A new
consumer with N skill-shipping dependencies must discover and hand-type all N names. The only
built-in permit-all is hand-writing `["*"]`. M2's planned `intent skills approve --all` does **not**
fill this gap: it writes `intent.lock` _from sources already matching `intent.skills`_; it does not
bootstrap `intent.skills` itself. So the gap is covered by neither M1 nor M2 as specced.

**Options considered (chosen: both 1 and 2):**

1. **`intent skills add <pkg>` / `remove` / `list` (Resolved D24) — interactive picker for incremental management.**
   Mirrors the shipped `intent exclude` `add`/`remove`/`list` family (`0.1.0` #157): the additive editor on
   `intent.skills[]` symmetric with the subtractive editor on `intent.exclude[]`. The nested-vs-flat
   sub-question is **resolved** (D24, §6): both editors are named after the array they edit, so the
   subtractive side is flat `intent exclude` (edits `intent.exclude`) and the additive side is
   `intent skills add`/`remove`/`list` (edits `intent.skills`); a bare `intent add` is rejected as
   ambiguous and off-pattern. Note the genuinely new step this introduces: `intent exclude` already
   _writes_ `package.json#intent.exclude`, while the `intent.skills` allowlist is still deliberately
   **read-only** today (Intent never writes it), so `intent skills add` is the first writer of the allowlist —
   a real trust-model change, not just a CLI affordance.
2. **`intent skills init` (new) — writes `intent.skills` from currently-discovered packages,**
   interactively. The consumer-side analog of M2's lockfile `approve --all`. Closes the
   onboarding-friction gap directly.

**Security constraint.** A bootstrap that auto-adds every discovered package _blindly_ defeats the
opt-in trust model. `init` must be **interactive and reviewable** — show the discovered list, let
the user confirm — never a silent allow-all (that is what `["*"]` is for, with its acknowledged-risk
banner).

**Scope.** Out of M1; resolved as D26. Same theme as P1 — how a consumer _ergonomically manages_
the allowlist — settled in the RFC before implementation.

**M2-bundling decision: kept out of M2 (the command set is resolved as D26; only its milestone placement is settled here).** There
is a real argument _for_ pairing: a fresh consumer's true first run is two steps — populate
`intent.skills` (P2) → write `intent.lock` (`approve --all`) — and the two share almost identical
interactive UX (show discovered list, user confirms), so shipping `approve --all` without `init`
leaves a visibly half-built onboarding. It is kept out anyway because: (1) M1 deliberately shipped
the allowlist **read-only** — Intent never writes `intent.skills` — so `init` is a distinct
trust-model change, not lockfile plumbing, and bundling smuggles a policy decision into a
reproducibility milestone; (2) the polished first run is already deferred to **after M5** (§7), so
P2 does not block M2's stated goal. If it is later pulled into M2,
the clean seam is: `init` writes `intent.skills` interactively, then hands off to the existing
`approve --all` — two commands, one flow, no shared internals beyond the discovery scan both run.
