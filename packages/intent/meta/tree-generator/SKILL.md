---
name: skill-tree-generator
description: >
  Generate, update, and version a complete skill tree (collection of SKILL.md
  files) for any JavaScript or TypeScript library. Produces core skills
  (framework-agnostic) and framework skills (React, Solid, Vue bindings)
  with dependency linking. Activate when producing skill files from a domain
  map, updating existing skills after a library version change, or auditing
  skill accuracy. Takes domain_map.yaml and skill_spec.md from
  skill-domain-discovery as primary inputs.
metadata:
  version: '3.0'
  category: meta-tooling
  input_artifacts:
    - skills/_artifacts/domain_map.yaml
    - skills/_artifacts/skill_spec.md
  output_artifacts:
    - skills/_artifacts/skill_tree.yaml
  skills:
    - skill-domain-discovery
---

# Skill Tree Generator

You produce and maintain a tree of SKILL.md files for a library. Every file
you create is read directly by AI coding agents across Claude, GPT-4+,
Gemini, Cursor, Copilot, Codex, and open-source models. Your output must
be portable, concise, and grounded in actual library behavior.

### Skill types

Every skill has a `type` field in its frontmatter. Valid types:

| Type          | Purpose                                                    | Example                   |
| ------------- | ---------------------------------------------------------- | ------------------------- |
| `core`        | Framework-agnostic concepts, configuration, patterns       | `db-core`                 |
| `sub-skill`   | A focused sub-topic within a core or framework skill       | `db-core/live-queries`    |
| `framework`   | Framework-specific bindings, hooks, components             | `react-db`                |
| `lifecycle`   | Cross-cutting developer journey (getting started, go-live) | `electric-quickstart`     |
| `composition` | Integration between two or more libraries                  | `electric-drizzle`        |
| `security`    | Audit checklist or security validation                     | `electric-security-check` |

Agents discover skills via `tanstack intent list` and read them directly
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
  from skill-domain-discovery
- Raw library documentation and source code (run a compressed domain
  discovery first)

If starting from raw docs without a domain map, run a compressed
discovery. This produces lower-fidelity output than the full
skill-domain-discovery skill — prefer running that when time permits.

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
skill-domain-discovery contains a single "Framework Integration" domain
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
an entry point to guide agents to the right sub-skill.

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

Add `"skills"` to each package's `files` array in `package.json` so
skill files are included in the published npm tarball:

```json
{
  "files": ["dist", "src", "skills"]
}
```

### Step 2 — Write the core skill

The core skill is the foundational overview for the library. It covers
framework-agnostic concepts and contains the sub-skill registry.

**Frontmatter:**

```yaml
---
name: [lib]-core
description: >
  [1–3 sentences. What this library does and the framework-agnostic
  concepts it provides. Pack with keywords: function names, config
  options, concepts. This is a routing key, not a human summary.]
type: core
library: [lib]
library_version: "[version this targets]"
---
```

**Body template:**

```markdown
# [Library Name] — Core Concepts

[One paragraph: what this library is, what problem it solves. Factual,
not promotional. Framework-agnostic.]

## Sub-Skills

| Need to... | Read                           |
| ---------- | ------------------------------ |
| [task 1]   | [lib]-core/[domain-1]/SKILL.md |
| [task 2]   | [lib]-core/[domain-2]/SKILL.md |

## Quick Decision Tree

- Setting up for the first time? → [lib]-core/[setup-domain]
- Working with [concept]? → [lib]-core/[concept-domain]
- Debugging [issue]? → [lib]-core/[domain] § Common Mistakes

## Version

Targets [library] v[X.Y.Z].
```

### Step 3 — Write core sub-skills

One SKILL.md per domain. Follow this structure exactly.

**Frontmatter:**

```yaml
---
name: [lib]-core/[domain-slug]
description: >
  [1–3 sentences. What this domain covers AND when to load it. Name
  specific functions, options, or APIs. Dense routing key.]
type: sub-skill
library: [lib]
library_version: "[version]"
sources:
  - "[repo]:docs/[path].md"
  - "[repo]:src/[path].ts"
---
```

**Body sections — in this order:**

**1. Setup**

Minimum working example for this domain.

- Use the library's core API, not framework-specific hooks
- Real package imports with exact names
- No `// ...` or `[your code here]` — complete and copy-pasteable
- If a concept is better explained with a framework hook, reference the
  framework skill: "For React usage, see `react-[lib]/SKILL.md`"

**2. Core Patterns**

2–4 patterns. For each:

- One-line heading: what it accomplishes
- Complete code block using core API
- One sentence of explanation only if not self-explanatory
- No framework-specific code — use core abstractions

**3. Common Mistakes**

Each `failure_mode` entry from the domain map becomes a Common Mistake
entry in the SKILL file. Minimum 3 entries. Complex domains target 5–6.

**Cross-skill failure modes:** The domain map may contain failure modes
with a `skills` list naming multiple skill slugs. Write these into
every SKILL file whose skill is listed. A developer loading the SSR
skill and a developer loading the state management skill both need to
see "stale state during hydration" — the same advice must appear in
both files. Do not deduplicate across skills at the cost of coverage.

Format:

````markdown
### [PRIORITY] [What goes wrong — 5–8 word phrase]

Wrong:

```[lang]
// code that looks correct but isn't
```
````

Correct:

```[lang]
// code that works
```

[One sentence: the specific mechanism by which the wrong version fails.]

Source: [doc page or source file:line]

````

Priority levels:
- **CRITICAL** — Breaks in production. Security risk or data loss.
- **HIGH** — Incorrect behavior under common conditions.
- **MEDIUM** — Incorrect under specific conditions or edge cases.

Every mistake must be plausible (an agent would generate it), silent
(no immediate crash), and grounded (traceable to doc or source).

**Failure mode status from domain map:** The domain map may include a
`status` field on failure modes. Handle as follows:
- `active` — Include as a normal Common Mistake entry
- `fixed-but-legacy-risk` — Include with a note: "Fixed in v[X] but
  agents trained on older code may still generate this pattern"
- `removed` — Do not include. The bug is fixed and the pattern is no
  longer relevant.

**4. References** (only when needed)

```markdown
## References

- [Complete option reference](references/options.md)
````

Create reference files when any of these apply — not just length overflow:

- **Length:** The skill would exceed 500 lines without them
- **Multiple subsystems:** The domain covers 3+ independent backends,
  adapters, or providers with distinct config interfaces. Create one
  reference file per subsystem (e.g. `references/electric-adapter.md`,
  `references/query-adapter.md`)
- **Dense API surface:** A topic has >10 distinct API patterns, operators,
  or option shapes that agents need for implementation. Move the full
  reference to `references/` and keep only the most common 2–3 in the
  SKILL.md
- **Deep validation/schema patterns:** If the library has schema
  validation, type transforms (TInput/TOutput), or similar deep
  configuration surfaces, give them a dedicated reference file even if
  they technically fit in the parent skill

### Step 4 — Write framework skills

Framework skills build on their core skill. They cover only what is
specific to the framework — hooks, components, providers, and
framework-specific patterns and mistakes.

**Frontmatter:**

```yaml
---
name: react-[lib]
description: >
  [1–3 sentences. React-specific bindings for [library]. Name the hooks,
  components, and providers. Mention React-specific patterns like SSR
  hydration if applicable.]
type: framework
library: [lib]
framework: react
library_version: "[version]"
requires:
  - [lib]-core
---
```

**Body template:**

```markdown
This skill builds on [lib]-core. Read [lib]-core first for foundational
concepts before applying React-specific patterns.

# [Library Name] — React

## Setup

[React-specific setup: provider, hook wiring, app entry point]

## Hooks and Components

[React hooks and components with complete examples]

## React-Specific Patterns

[Patterns that only apply in React: concurrent features, Suspense
integration, SSR/hydration, etc.]

## Common Mistakes

[Only React-specific mistakes. Do not repeat core mistakes. Examples:
calling hooks outside provider, missing Suspense boundary, hydration
mismatch, etc.]
```

**Framework sub-skills** follow the same pattern as core sub-skills but
with the framework frontmatter:

```yaml
---
name: react-[lib]/[domain-slug]
description: >
  [React-specific description for this domain.]
type: sub-skill
library: [lib]
framework: react
library_version: "[version]"
requires:
  - [lib]-core
  - [lib]-core/[domain-slug]
---

This skill builds on [lib]-core/[domain-slug]. Read the core skill first.
```

### Step 5 — Write cross-domain tension notes

The domain map may contain a `tensions` section listing design conflicts
between domains. For each tension, add a brief note to the Common
Mistakes section of every SKILL file whose domain is involved. Format:

```markdown
### HIGH Tension: [short phrase]

This domain's patterns conflict with [other domain]. [One sentence
describing the pull.] Agents optimizing for [this domain's goal]
tend to [specific mistake] because they don't account for [other
domain's constraint].

See also: [lib]-core/[other-domain]/SKILL.md § Common Mistakes
```

The cross-reference ensures agents that load one skill are pointed
toward the related skill where the other side of the tension lives.

### Step 6 — Write composition skills (if applicable)

Use the `compositions` entries from `domain_map.yaml` (populated during
skill-domain-discovery Phase 2h) to identify which composition skills
to produce.

Composition skills cover how two or more libraries work together. These
are framework-specific by default (the integration patterns depend on
framework hooks and providers).

**Frontmatter:**

```yaml
---
name: compositions/[lib-a]-[lib-b]
description: >
  [How lib-a and lib-b wire together. Name the specific integration
  points: functions, hooks, patterns.]
type: composition
library_version: "[version of primary lib]"
requires:
  - [lib-a]-core
  - react-[lib-a]
  - [lib-b]-core
  - react-[lib-b]
---

This skill requires familiarity with both [lib-a] and [lib-b].
Read their core and framework skills first.
```

**Body structure:**

1. **Integration Setup** — How to wire the two libraries together
2. **Core Integration Patterns** — 2–4 patterns showing them working in concert
3. **Common Mistakes** — Mistakes that only occur at the integration boundary

Do not duplicate content from either library's individual skills. Focus
exclusively on the seam between them.

### Step 7 — Write checklist/audit skills (where applicable)

Some skills don't fit the standard body structure (Setup → Core Patterns
→ Common Mistakes). Security, go-live, and some lifecycle skills are
audit-oriented — the agent runs through a checklist to verify correctness
rather than learning patterns. Use the alternative body structure below
for these skill types.

**When to use the checklist body:**

- `security` type skills — pre-deploy security validation
- `lifecycle` type skills focused on verification (go-live, migration)
- Any skill where the primary action is "check these things" not "learn
  these patterns"

**Frontmatter:**

```yaml
---
name: react-[lib]/security
description: >
  Go-live security validation for [library]. Checks [specific concerns].
type: security
library: [lib]
framework: react
library_version: '[version]'
requires:
  - react-[lib]
---
```

**Alternative body template (checklist/audit):**

````markdown
# [Library Name] — [Security | Go-Live | Migration] Checklist

Run through each section before [deploying | releasing | migrating].

## [Category 1] Checks

### Check: [what to verify]

Expected:

```[lang]
// correct configuration or code
```
````

Fail condition: [what indicates this check failed]
Fix: [one-line remediation]

### Check: [what to verify]

[same structure]

## [Category 2] Checks

[same structure]

## Common Security Mistakes

[Wrong/correct pairs specific to this library, same format as
Common Mistakes in standard skills]

## Pre-Deploy Summary

- [ ] [Verification 1]
- [ ] [Verification 2]
- [ ] [Verification 3]

````

The key differences from the standard body:
- No "Setup" section — the agent already has the app running
- Checks replace "Core Patterns" — each check is a verification, not a
  teaching pattern
- The summary checklist at the end gives agents a quick pass/fail list
- Common Mistakes section is still present for wrong/correct pairs

### Step 8 — Validate the complete tree

Run every check before outputting. Fix any failures before proceeding.

| Check | Rule |
|-------|------|
| Every skill from domain_map has a SKILL.md | No orphaned skills |
| Core/framework split is clean | No framework hooks in core skills |
| Every framework skill has `requires` | Links to its core skill |
| Framework skill opens with dependency note | "builds on [core]" prose line |
| Every skill under 500 lines | Move excess to references/ |
| Every code block has real imports | Exact package name, correct adapter |
| No concept explanations | No "TypeScript is...", no "React hooks are..." |
| No marketing prose | First body line is heading or dependency note |
| Every code block is complete | Works without modification when pasted |
| Common Mistakes are silent | Not obvious compile errors |
| Common Mistakes are library-specific | Not generic TS/React mistakes |
| Common Mistakes are sourced | Every mistake traceable to doc or source |
| Core skills reference framework skills | "For React usage, see..." |
| Framework skills don't repeat core content | Only framework-specific |
| Composition skills don't repeat individual skills | Only the seam |
| `name` matches directory path | `router-core/search-params` → `router-core/search-params/SKILL.md` |
| `sources` filled in sub-skills | At least one repo:path per sub-skill |
| Cross-skill failures in all relevant files | Failure modes with multiple `skills` appear in each listed SKILL.md |
| Tensions noted in affected skills | Each tension has notes in all involved domain skills |
| Framework domains decomposed per-package | No single skill covering multiple framework adapters |
| Adapter-heavy domains have references | 3+ adapters/backends → one reference file per adapter |
| Dense API surfaces in references | >10 distinct patterns → reference file, not inline |
| Checklist skills use audit body | Security/go-live skills use checklist template, not Setup → Core Patterns → Common Mistakes |

---

## Workflow B — Update existing skills

### Trigger conditions

Run when:
- The library has released a new version
- A maintainer reports skills produce outdated code
- A changelog or migration guide has been published since skill creation
- Feedback reports indicate skill content is inaccurate

### Step 1 — Detect staleness

Compare each skill's `library_version` against the current library version.

1. Read changelog entries between the two versions
2. Read migration guide (if one exists)
3. For each skill, check if its `sources` files have changed

Produce a staleness report:

```yaml
# staleness_report.yaml
library: "[name]"
library_version_in_skills: "[old]"
library_version_current: "[new]"

stale_skills:
  - skill: "[skill name]"
    reason: "[what changed]"
    severity: "[BREAKING | DEPRECATION | BEHAVIORAL | ADDITIVE]"
    changelog_entry: "[relevant entry]"
    affected_sections:
      - "[Setup | Core Patterns | Common Mistakes]"

current_skills:
  - skill: "[skill name]"
    reason: "[no changes affect this domain]"
````

### Step 2 — Update stale skills

**BREAKING changes:**

1. Old pattern becomes a new Common Mistake entry (wrong/correct pair)
2. Update Setup if initialization changed
3. Update Core Patterns if idiomatic approach changed
4. Bump `library_version` in frontmatter
5. Check both core AND framework skills — breaking changes may affect both

**DEPRECATION changes:**

1. Add Common Mistake: deprecated API as wrong, replacement as correct
2. Update Core Patterns to use non-deprecated API
3. Bump `library_version`

**BEHAVIORAL changes:**

1. Default value changed → add Common Mistake entry
2. Type signature more restrictive → add Common Mistake entry
3. Update affected code blocks
4. Bump `library_version`

**ADDITIVE changes:**

1. Evaluate if new feature belongs in existing domain or needs a new skill
2. If existing: add to Core Patterns or references/
3. If new skill needed: create it and update the parent skill's sub-skill
   registry
4. Bump `library_version`

### Step 3 — Produce a changelog entry

```markdown
## [date]

### Updated for [library] v[new version]

**Breaking changes:**

- [skill name]: [what changed and why]

**Deprecation updates:**

- [skill name]: [old API] → [new API]

**New skills:**

- [skill name]: [what it covers]
```

---

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
| `name` matches directory                    | `router-core/search-params` → file at that path                                     |
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

## Meta-skill feedback (alpha default)

After producing the skill tree artifact, update a single Markdown feedback
draft for all three meta skills used in scaffolding. If a draft exists from
Domain Discovery, keep it and fill only the **Tree Generator** section. If
no draft exists, create it using this exact template.

```
# Intent Meta Skill Feedback

## Domain Discovery
- What worked well:
- What was confusing or missing:
- Suggestions for improvement:
- Overall rating: good | mixed | bad

## Tree Generator
- What worked well:
- What was confusing or missing:
- Suggestions for improvement:
- Overall rating: good | mixed | bad

## Generate Skill
- What worked well:
- What was confusing or missing:
- Suggestions for improvement:
- Overall rating: good | mixed | bad

## Context (optional)
- Library:
- Repo:
- Docs:
- Notes:
```

Do not submit feedback yet. Carry this draft forward to the generate-skill
step.
