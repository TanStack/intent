---
name: tree-generator
description: >
  Generate, update, and version a complete skill tree (collection of SKILL.md
  files) for any JavaScript or TypeScript library. Produces core skills
  (framework-agnostic) and framework skills (React, Solid, Vue bindings)
  with dependency linking. Activate when producing skill files from a domain
  map, updating existing skills after a library version change, or auditing
  skill accuracy. Takes domain_map.yaml and skill_spec.md from
  domain-discovery as primary inputs.
metadata:
  version: '3.0'
  category: meta-tooling
  input_artifacts: 'skills/_artifacts/domain_map.yaml; skills/_artifacts/skill_spec.md'
  output_artifacts: 'skills/_artifacts/skill_tree.yaml'
  skills: 'domain-discovery'
---

# Skill Tree Generator

You produce and maintain a tree of SKILL.md files for a library. Every file
you create is read directly by AI coding agents across Claude, GPT-4+,
Gemini, Cursor, Copilot, Codex, and open-source models. Your output must
be portable, concise, and grounded in actual library behavior.

### Skill types

Every skill has a `metadata.type` field in its frontmatter. Valid types:

| Type          | Purpose                                                    | Example                   |
| ------------- | ---------------------------------------------------------- | ------------------------- |
| `core`        | Framework-agnostic concepts, configuration, patterns       | `db-core`                 |
| `sub-skill`   | A focused sub-topic within a core or framework skill       | `db-core/live-queries`    |
| `framework`   | Framework-specific bindings, hooks, components             | `react-db`                |
| `lifecycle`   | Cross-cutting developer journey (getting started, go-live) | `electric-quickstart`     |
| `composition` | Integration between two or more libraries                  | `electric-drizzle`        |
| `security`    | Audit checklist or security validation                     | `electric-security-check` |

Agents discover skills via `npx @tanstack/intent list` and read them directly
from `node_modules`. Framework skills declare a `requires` dependency on
their core skill so agents load them in the right order.

There are two workflows. Detect which applies.

**Workflow A — Generate:** Build a complete skill tree from a domain map.
**Workflow B — Update:** Diff a library version change and update skills.

---

## Workflow A — Generate skill tree

### Prerequisites

You need one of:

- `skills/_artifacts/domain_map.yaml` and `skills/_artifacts/skill_spec.md`
  from domain-discovery
- Raw library documentation and source code (run a compressed domain
  discovery first)

If starting from raw docs without a domain map, run a compressed
discovery. This produces lower-fidelity output than the full
domain-discovery skill — prefer running that when time permits.

1. Build a concept inventory (every export, config key, constraint, warning)
2. Group into capability domains using work-oriented names (let library complexity drive the count — 2–3 for focused libraries, more for large frameworks)
3. Enumerate 10–20 task-focused skills from the intersection of domains
   and developer tasks
4. Extract 3+ failure modes per skill (plausible, silent, grounded)
5. Proceed to Step 1 below

### Scaffold flow output

If the maintainer uses a custom skills root, replace `skills/` in the paths
below with their chosen directory.

For the scaffold workflow, produce a single artifact before writing any
SKILL.md files:

- `skills/_artifacts/skill_tree.yaml`

This file enumerates every skill that must be generated in the next step.
Do not write SKILL.md files yet unless explicitly asked.

Use this format:

```yaml
# skills/_artifacts/skill_tree.yaml
library:
  name: '[package-name]'
  version: '[version]'
  repository: '[repo URL]'
  description: '[one line]'
generated_from:
  domain_map: 'skills/_artifacts/domain_map.yaml'
  skill_spec: 'skills/_artifacts/skill_spec.md'
generated_at: '[ISO date]'

skills:
  - name: '[task-focused skill name]'
    slug: '[kebab-case]'
    type: 'core | sub-skill | framework | lifecycle | composition | security'
    domain: '[domain slug]'
    path: 'skills/[path]/SKILL.md'
    package: '[package directory, e.g. packages/client]' # monorepo only — which package this skill belongs to
    description: '[1–2 sentence agent-facing routing key]'
    requires:
      - '[other skill slugs]' # omit if none
    sources:
      - '[Owner/repo]:docs/[path].md'
      - '[Owner/repo]:src/[path].ts'
    subsystems:
      - '[adapter/backend name]' # omit if none
    references:
      - 'references/[file].md' # omit if none
```

**Monorepo layout:** For monorepos, each skill's `path` is relative to its
package directory (e.g. `packages/client/skills/core/SKILL.md`). Set the
`package` field so generate-skill knows where to write the file. The domain
map artifacts stay at the repo root.

### Minimal library fast path

If the domain map contains **fewer than 5 skills** and no framework
adapter packages, skip the core overview + sub-skill registry pattern.
Instead:

- Use **flat structure** — each skill gets its own `skills/[skill-name]/SKILL.md`
- **No router skill** — the intent CLI `list` command is sufficient for discovery
- **No core overview skill** — go directly to individual skill files
- Each skill is type `core` (not `sub-skill`) and stands alone without
  a parent registry
- Skip Step 2 (core overview) and Step 3 (sub-skills) — go directly to
  writing individual skills as standalone core skills using Step 3's body
  format

This avoids unnecessary scaffolding for focused libraries where the
overhead of a hierarchical skill tree exceeds the navigation benefit.

### Step 1 — Plan the file tree

From the domain map, each entry in the `skills` list becomes a SKILL.md
file. The `type` field on each skill (`core`, `framework`, `lifecycle`,
`composition`) determines where it goes. Determine the file tree:

**Core vs framework decision:**

| Content                                        | Goes in... |
| ---------------------------------------------- | ---------- |
| Mental models, concepts, lifecycle             | Core       |
| Configuration options and their effects        | Core       |
| Type system, generics, inference               | Core       |
| Common mistakes that apply to all frameworks   | Core       |
| Hooks (`useX`, `createX`)                      | Framework  |
| Components (`<Link>`, `<Outlet>`)              | Framework  |
| Provider setup and wiring                      | Framework  |
| SSR/hydration patterns specific to a framework | Framework  |
| Framework-specific gotchas                     | Framework  |

If a library has no framework adapters (e.g. Store, DB), produce only
core skills.

**Framework-integration domain decomposition:** If the domain map from
domain-discovery contains a single "Framework Integration" domain
and the library has separate framework adapter packages, decompose it
into per-framework skills co-located with each adapter package. Do not
produce a single monolithic framework-integration skill that covers
React, Vue, Solid, etc. in one file.

**Adapter-heavy domains:** When a domain covers multiple backends or
adapters with distinct config interfaces (e.g. 5 sync adapters, 3
database drivers), keep one SKILL.md for the shared patterns but
produce one reference file per adapter with its specific config,
setup, and gotchas. The SKILL.md covers what's common; each
`references/[adapter].md` covers what's unique.

**Flat vs nested structure:**

Choose the structure that matches how the domain map's skills are shaped.

Use **nested** (`[lib]-core/[domain]/SKILL.md`) when:

- Developer tasks cluster cleanly into 3–5 conceptual domains
- The library has a clear core + framework adapter split
- Skills build on each other in a layered way

Use **flat** (`skills/[skill-name]/SKILL.md`) when:

- Developer tasks are task-focused and don't nest into domains
- The domain discovery process recommended task-focused skills
- Skills map 1:1 to distinct developer intents with minimal overlap

Both are valid. The domain map's `type` field and structure will signal
which fits. When in doubt, prefer flat — it's simpler and each skill
is independently discoverable.

**Nested structure:**

```
skills/
├── [lib]-core/                   # Core skill for the library
│   ├── SKILL.md                  # Core overview + sub-skill registry
│   ├── [domain-1]/
│   │   └── SKILL.md             # Core sub-skill
│   ├── [domain-2]/
│   │   └── SKILL.md
│   └── references/              # Optional overflow content
│       └── options.md
├── react-[lib]/                  # React framework skill
│   ├── SKILL.md                  # React overview + sub-skill registry
│   ├── [domain-1]/
│   │   └── SKILL.md             # React-specific sub-skill
│   └── references/
├── solid-[lib]/                  # Solid framework skill (if applicable)
│   └── SKILL.md
├── vue-[lib]/                    # Vue framework skill (if applicable)
│   └── SKILL.md
```

**Flat structure:**

```
skills/
├── [lib]-shapes/                 # Task-focused skill
│   ├── SKILL.md
│   └── references/
│       └── shape-options.md
├── [lib]-auth/                   # Another task skill
│   └── SKILL.md
├── [lib]-proxy/
│   └── SKILL.md
├── [lib]-quickstart/             # Lifecycle skill
│   └── SKILL.md
├── [lib]-go-live/                # Lifecycle skill
│   └── SKILL.md
├── [lib]-drizzle/                # Composition skill
│   └── SKILL.md
```

**Router skill:** A router skill (lightweight entry point with a decision
table) is optional. If the intent CLI provides `list` and `show`
commands, agents can discover skills directly without a router. Only
create a router skill if the skill set is large enough (15+) that
browsing the list is insufficient, or if the nested structure needs
an entry point to guide agents to the right sub-skill. Libraries with
fewer than 5 skills should never have a router skill.

**Source repository layout for npm distribution:**

Skills must ship with their respective packages so they're available in
`node_modules` after install. In a monorepo, co-locate skills with the
package they document:

```
packages/
├── [lib]/                        # Core package
│   ├── src/
│   ├── skills/                   # Core skills live here
│   │   ├── [lib]-core/
│   │   │   ├── SKILL.md
│   │   │   └── [domain]/SKILL.md
│   │   └── compositions/        # Composition skills with co-used libs
│   └── package.json             # Add "skills" to files array
├── react-[lib]/                  # React adapter package
│   ├── src/
│   ├── skills/                   # React framework skills live here
│   │   └── react-[lib]/
│   │       └── SKILL.md
│   └── package.json             # Add "skills" to files array
```

Run `npx @tanstack/intent@latest edit-package-json` to wire each package's `package.json`
automatically (adds `"skills"`, `"bin"`, and `"!skills/_artifacts"` to the
`files` array, and adds the `bin` entry if missing).

### Steps 2–7 — Write skills

When writing skill files (after the scaffold plan is approved), read
[the skill-writing procedures and templates](references/write-skills.md).
Follow the applicable steps in order: core overview, core sub-skills,
framework skills, tension notes, composition skills, and checklist skills.
The reference owns each type's frontmatter, body, dependency rules,
failure-mode handling, and reference-file criteria.

For the minimal-library fast path, use Step 3's body format for standalone
core skills. For scaffold-only requests, stop after `skill_tree.yaml`.

### Step 8 — Validate the complete tree

Run every check before outputting. Fix any failures before proceeding.

| Check                                             | Rule                                                                                        |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Every skill from domain_map has a SKILL.md        | No orphaned skills                                                                          |
| Core/framework split is clean                     | No framework hooks in core skills                                                           |
| Every framework skill has `requires`              | Links to its core skill                                                                     |
| Framework skill opens with dependency note        | "builds on [core]" prose line                                                               |
| Every skill under 500 lines                       | Move excess to references/                                                                  |
| Every code block has real imports                 | Exact package name, correct adapter                                                         |
| No concept explanations                           | No "TypeScript is...", no "React hooks are..."                                              |
| No marketing prose                                | First body line is heading or dependency note                                               |
| Every code block is complete                      | Works without modification when pasted                                                      |
| Common Mistakes are silent                        | Not obvious compile errors                                                                  |
| Common Mistakes are library-specific              | Not generic TS/React mistakes                                                               |
| Common Mistakes are sourced                       | Every mistake traceable to doc or source                                                    |
| Core skills reference framework skills            | "For React usage, see..."                                                                   |
| Framework skills don't repeat core content        | Only framework-specific                                                                     |
| Composition skills don't repeat individual skills | Only the seam                                                                               |
| `name` matches parent directory                   | `name: search-params` → `router-core/search-params/SKILL.md`                                |
| `sources` filled in sub-skills                    | At least one repo:path per sub-skill                                                        |
| Cross-skill failures in all relevant files        | Failure modes with multiple `skills` appear in each listed SKILL.md                         |
| Tensions noted in affected skills                 | Each tension has notes in all involved domain skills                                        |
| Framework domains decomposed per-package          | No single skill covering multiple framework adapters                                        |
| Adapter-heavy domains have references             | 3+ adapters/backends → one reference file per adapter                                       |
| Dense API surfaces in references                  | >10 distinct patterns → reference file, not inline                                          |
| Checklist skills use audit body                   | Security/go-live skills use checklist template, not Setup → Core Patterns → Common Mistakes |

---

## Workflow B — Update existing skills

When a library version, changelog, migration guide, or accuracy report
requires updating existing skills, read [the update workflow](references/update-skills.md).
Produce its staleness report, update the affected skills according to the
change category, and write the changelog entry. Apply the constraints below
to every updated file.

## Constraints — verify for every file

| Check                                       | Rule                                                                                |
| ------------------------------------------- | ----------------------------------------------------------------------------------- |
| Under 500 lines per SKILL.md                | Move excess to references/; also create references for content depth                |
| Real imports in every code block            | Exact package, correct adapter                                                      |
| No external concept explanations            | No "TypeScript is...", no "React hooks are..." — library-specific concepts are fine |
| No marketing prose                          | First body line is heading, code, or dependency note                                |
| Complete code blocks                        | Every block works without modification                                              |
| Common Mistakes are silent                  | Not obvious compile errors                                                          |
| Common Mistakes are library-specific        | Not generic TS/React mistakes                                                       |
| Common Mistakes are sourced                 | Traceable to doc or source                                                          |
| Core skills are framework-agnostic          | No hooks, no components, no providers                                               |
| Framework skills have `requires`            | Lists core dependency                                                               |
| Framework skills open with dependency note  | First prose line references core                                                    |
| Composition skills require all dependencies | Lists all core + framework skills                                                   |
| `name` matches parent directory             | `name: search-params` → `router-core/search-params/SKILL.md`                        |
| `library_version` in every frontmatter      | Which version the skill targets                                                     |
| Cross-skill failures duplicated             | Each listed skill gets the failure mode                                             |
| Tensions cross-referenced                   | Tension notes in each involved skill point to the other                             |
| Skills ship with packages                   | `"skills"` in package.json `files` array                                            |
| Checklist skills use audit template         | Security/go-live skills use checklist body, not standard body                       |

---

## Cross-model compatibility

Output is consumed by all major AI coding agents. To ensure consistency:

- Markdown with YAML frontmatter — universally parsed
- No XML tags in generated skill content
- Code blocks use triple backticks with language annotation
- Section boundaries use ## headers
- Descriptions are keyword-packed for routing
- Examples show concrete values, never placeholders
- Positive instructions ("Use X") over negative ("Don't use Y")
- Critical info at start or end of sections (not buried in middle)
- Each SKILL.md is self-contained except for declared `requires`

---

## Output order

When generating a complete skill tree:

1. Core overview SKILL.md — entry point for the library
2. Core sub-skills in domain order
3. Framework overview SKILL.md for each framework
4. Framework sub-skills
5. Composition skills (if applicable)
6. Security skills (if applicable)
7. references/ files for any skill that needs them
8. CHANGELOG.md entry

When updating:

1. staleness_report.yaml
2. Updated SKILL.md files (core then framework)
3. CHANGELOG.md entry

---
