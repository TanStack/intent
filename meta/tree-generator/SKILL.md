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
  version: "3.0"
  category: meta-tooling
  input_artifacts:
    - domain_map.yaml
    - skill_spec.md
  skills:
    - skill-domain-discovery
---

# Skill Tree Generator

You produce and maintain a tree of SKILL.md files for a library. Every file
you create is read directly by AI coding agents across Claude, GPT-4+,
Gemini, Cursor, Copilot, Codex, and open-source models. Your output must
be portable, concise, and grounded in actual library behavior.

Skills are split into two layers:

- **Core skills** — framework-agnostic concepts, configuration, and patterns
- **Framework skills** — framework-specific bindings, hooks, components

All generated skills live in the `tanstack/playbooks` repository and publish
as part of the `@tanstack/playbooks` npm package. Skills do NOT live in the
library's source repo. The playbooks repo is the single source of truth for
all TanStack agent skills.

Agents discover skills via `tanstack playbook list` and read them directly
from `node_modules/@tanstack/playbooks/skills/`. Framework skills declare
a `requires` dependency on their core skill so agents load them in the right
order.

There are two workflows. Detect which applies.

**Workflow A — Generate:** Build a complete skill tree from a domain map.
**Workflow B — Update:** Diff a library version change and update skills.

---

## Directory Convention

Every library follows the same directory structure inside `skills/`. This
convention is mandatory — both new and updated skills must follow it. When
updating existing skills, check the existing directory structure first and
place files accordingly.

```
skills/
├── [lib]/                        # One directory per library
│   ├── core/                     # Core skills (framework-agnostic)
│   │   ├── SKILL.md              # Core overview + sub-skill registry
│   │   ├── [domain-1]/
│   │   │   └── SKILL.md          # Core sub-skill
│   │   ├── [domain-2]/
│   │   │   └── SKILL.md
│   │   └── references/           # Optional overflow content
│   │       └── options.md
│   ├── react/                    # React framework skill
│   │   ├── SKILL.md              # React overview + sub-skill registry
│   │   ├── [domain-1]/
│   │   │   └── SKILL.md          # React-specific sub-skill
│   │   └── references/
│   ├── solid/                    # Solid framework skill (if applicable)
│   │   └── SKILL.md
│   └── vue/                      # Vue framework skill (if applicable)
│       └── SKILL.md
├── compositions/                  # Cross-library skills
│   ├── router-query/
│   │   └── SKILL.md
│   └── start-query/
│       └── SKILL.md
└── tanstack/                      # Ecosystem router (always present)
    └── SKILL.md
```

**Examples:**

```
skills/router/core/SKILL.md                    → Router core overview
skills/router/core/search-params/SKILL.md      → Core sub-skill
skills/router/react/SKILL.md                   → React Router overview
skills/router/react/ssr-patterns/SKILL.md      → React-specific sub-skill
skills/query/core/SKILL.md                     → Query core overview
skills/query/react/SKILL.md                    → React Query overview
skills/db/core/SKILL.md                        → DB core overview
skills/db/react/SKILL.md                       → React DB overview
skills/compositions/router-query/SKILL.md      → Router + Query integration
```

Libraries with no framework adapters (e.g. Store) only have `[lib]/core/`.
Libraries with only one framework (e.g. Start is React-only) have
`[lib]/react/` with no `core/` unless there are framework-agnostic concepts
worth separating.

**When updating existing skills:** Always check what exists under
`skills/[lib]/` first. Place new files into the existing structure. Do not
create a new layout or rename directories.

---

## Workflow A — Generate skill tree

### Prerequisites

You need one of:
- A `domain_map.yaml` and `skill_spec.md` from skill-domain-discovery
- Raw library documentation and source code (run a compressed domain
  discovery first)

If starting from raw docs without a domain map:

1. Build a concept inventory (every export, config key, constraint, warning)
2. Group into 4–7 capability domains using work-oriented names
3. Extract 3+ failure modes per domain (plausible, silent, grounded)
4. Proceed to Step 1 below

### Step 1 — Plan the file tree

From the domain map, determine which skills are core and which are
framework-specific.

**Core vs framework decision:**

| Content | Goes in... |
|---------|-----------|
| Mental models, concepts, lifecycle | `[lib]/core/` |
| Configuration options and their effects | `[lib]/core/` |
| Type system, generics, inference | `[lib]/core/` |
| Common mistakes that apply to all frameworks | `[lib]/core/` |
| Hooks (`useX`, `createX`) | `[lib]/[framework]/` |
| Components (`<Link>`, `<Outlet>`) | `[lib]/[framework]/` |
| Provider setup and wiring | `[lib]/[framework]/` |
| SSR/hydration patterns specific to a framework | `[lib]/[framework]/` |
| Framework-specific gotchas | `[lib]/[framework]/` |

**Framework-integration domain decomposition:** If the domain map from
skill-domain-discovery contains a single "Framework Integration" domain
(or similar) that covers multiple frameworks, and the library has separate
framework adapter packages, decompose it into per-framework skills. Each
framework adapter gets its own skill under `[lib]/[framework]/`. Do not
combine multiple frameworks into a single skill.

If a library has no framework adapters, produce only `[lib]/core/` skills.

### Step 2 — Write the core overview skill

The core overview is the entry point for the library's core skills. It
covers framework-agnostic concepts and contains the sub-skill registry.

**Frontmatter:**

```yaml
---
name: [lib]/core
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

| Need to... | Read |
|------------|------|
| [task 1] | [lib]/core/[domain-1]/SKILL.md |
| [task 2] | [lib]/core/[domain-2]/SKILL.md |

## Quick Decision Tree

- Setting up for the first time? → [lib]/core/[setup-domain]
- Working with [concept]? → [lib]/core/[concept-domain]
- Debugging [issue]? → [lib]/core/[domain] § Common Mistakes

## Version

Targets [library] v[X.Y.Z].
```

### Step 3 — Write core sub-skills

One SKILL.md per domain. Follow this structure exactly.

**Frontmatter:**

```yaml
---
name: [lib]/core/[domain-slug]
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
  framework skill: "For React usage, see `[lib]/react/SKILL.md`"

**2. Core Patterns**

2–4 patterns. For each:
- One-line heading: what it accomplishes
- Complete code block using core API
- One sentence of explanation only if not self-explanatory
- No framework-specific code — use core abstractions

**3. Common Mistakes**

Minimum 3 entries. Complex domains target 5–6. Format:

```markdown
### [PRIORITY] [What goes wrong — 5–8 word phrase]

Wrong:
```[lang]
// code that looks correct but isn't
```

Correct:
```[lang]
// code that works
```

[One sentence: the specific mechanism by which the wrong version fails.]

Source: [doc page or source file:line]
```

Priority levels:
- **CRITICAL** — Breaks in production. Security risk or data loss.
- **HIGH** — Incorrect behavior under common conditions.
- **MEDIUM** — Incorrect under specific conditions or edge cases.

Every mistake must be:
- **Plausible** — An agent would generate this because it looks correct
- **Silent** — No immediate crash; fails at runtime or conditionally
- **Grounded** — Traceable to a specific doc page, source, or issue

Prioritize failure modes with `confidence: confirmed` and
`status: active` from the domain map. Include `fixed-but-legacy-risk`
items when agents are likely to have seen the old pattern in training data.

**4. References** (only when needed)

```markdown
## References

- [Complete option reference](references/options.md)
```

Use references/ when the skill would exceed 500 lines without them.

### Step 4 — Write framework skills

Framework skills build on their core skill. They cover only what is
specific to the framework — hooks, components, providers, and
framework-specific patterns and mistakes.

**One skill per framework adapter.** If the library has `@tanstack/react-db`,
`@tanstack/vue-db`, and `@tanstack/solid-db`, produce three separate
framework skills at `db/react/`, `db/vue/`, and `db/solid/`.

**Frontmatter:**

```yaml
---
name: [lib]/react
description: >
  [1–3 sentences. React-specific bindings for [library]. Name the hooks,
  components, and providers. Mention React-specific patterns like SSR
  hydration if applicable.]
type: framework
library: [lib]
framework: react
library_version: "[version]"
requires:
  - [lib]/core
---
```

**Body template:**

```markdown
This skill builds on [lib]/core. Read [lib]/core first for foundational
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
name: [lib]/react/[domain-slug]
description: >
  [React-specific description for this domain.]
type: sub-skill
library: [lib]
framework: react
library_version: "[version]"
requires:
  - [lib]/core
  - [lib]/core/[domain-slug]
---

This skill builds on [lib]/core/[domain-slug]. Read the core skill first.
```

### Step 5 — Write composition skills (if applicable)

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
  - [lib-a]/core
  - [lib-a]/react
  - [lib-b]/core
  - [lib-b]/react
---

This skill requires familiarity with both [lib-a] and [lib-b].
Read their core and framework skills first.
```

**Body structure:**

1. **Integration Setup** — How to wire the two libraries together
2. **Core Integration Patterns** — 2–4 patterns showing them working together
3. **Common Mistakes** — Mistakes that only occur at the integration boundary

Do not duplicate content from either library's individual skills. Focus
exclusively on the seam between them.

### Step 6 — Write security/go-live skills (where applicable)

For libraries with security-sensitive surface area (server functions,
auth, data exposure):

```yaml
---
name: [lib]/react/security
description: >
  Go-live security validation for [library]. Checks [specific concerns].
type: security
library: [lib]
framework: react
library_version: "[version]"
requires:
  - [lib]/react
---
```

Structure as a checklist the agent can run through before deployment:

1. **Validation checks** — What to verify, with code showing correct config
2. **Common security mistakes** — Wrong/correct pairs specific to this library
3. **Pre-deploy checklist** — Ordered list of verifications

### Step 7 — Validate the complete tree

Run every check before outputting. Fix any failures before proceeding.

| Check | Rule |
|-------|------|
| Every domain from domain_map has a skill | No orphaned domains |
| Directory convention followed | `skills/[lib]/core/`, `skills/[lib]/react/`, etc. |
| Core/framework split is clean | No framework hooks in core skills |
| Framework-integration decomposed | One skill per framework adapter, not combined |
| Every framework skill has `requires` | Links to its core skill |
| Framework skill opens with dependency note | "builds on [lib]/core" prose line |
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
| `name` matches directory path | `router/core/search-params` → that path |
| sources filled | At least one repo:path per sub-skill |

---

## Workflow B — Update existing skills

### Before you start

Check the existing directory structure under `skills/[lib]/`. Your updates
must fit into the existing layout. Do not rename directories, reorganize
the tree, or create a parallel structure. If the library already has skills,
you are editing files in place and adding new ones where needed.

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
    path: "skills/[lib]/[core|framework]/[file]"
    reason: "[what changed]"
    severity: "[BREAKING | DEPRECATION | BEHAVIORAL | ADDITIVE]"
    changelog_entry: "[relevant entry]"
    affected_sections:
      - "[Setup | Core Patterns | Common Mistakes]"

current_skills:
  - skill: "[skill name]"
    reason: "[no changes affect this domain]"
```

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
3. If new skill needed: create it under the existing `skills/[lib]/` tree
   and update the parent skill's sub-skill registry
4. Bump `library_version`

**New framework adapter:**
1. Create `skills/[lib]/[framework]/SKILL.md`
2. Use the existing React (or first) framework skill as a structural
   reference — same sections, same depth
3. Add `requires: [lib]/core` to frontmatter
4. Update `package_map.yaml` with the new package → skill mapping

### Step 3 — Update package_map.yaml (only if needed)

The `package_map.yaml` only needs updating when:
- A new package is added to the library
- A new framework adapter is published
- A skill is renamed or removed

For content updates within existing skills, `package_map.yaml` does not change.

### Step 4 — Produce a changelog entry

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

| Check | Rule |
|-------|------|
| Under 500 lines per SKILL.md | Move excess to references/ |
| Directory convention followed | `skills/[lib]/core/`, `skills/[lib]/[framework]/` |
| Existing structure preserved (updates) | No renames, no reorganization |
| Real imports in every code block | Exact package, correct adapter |
| No concept explanations | No TypeScript/React/framework tutorials |
| No marketing prose | First body line is heading, code, or dependency note |
| Complete code blocks | Every block works without modification |
| Common Mistakes are silent | Not obvious compile errors |
| Common Mistakes are library-specific | Not generic TS/React mistakes |
| Common Mistakes are sourced | Traceable to doc or source |
| Core skills are framework-agnostic | No hooks, no components, no providers |
| Framework skills have `requires` | Lists core dependency |
| Framework skills open with dependency note | First prose line references core |
| Framework-integration decomposed | One skill per adapter, not combined |
| Composition skills require all dependencies | Lists all core + framework |
| `name` matches directory | `router/core/search-params` → file at that path |
| `library_version` in every frontmatter | Which version the skill targets |

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

1. Core overview SKILL.md — `skills/[lib]/core/SKILL.md`
2. Core sub-skills in domain order — `skills/[lib]/core/[domain]/SKILL.md`
3. Framework overview for each framework — `skills/[lib]/react/SKILL.md`
4. Framework sub-skills — `skills/[lib]/react/[domain]/SKILL.md`
5. Composition skills — `skills/compositions/[name]/SKILL.md`
6. Security skills — `skills/[lib]/[framework]/security/SKILL.md`
7. references/ files for any skill that needs them
8. CHANGELOG.md entry

When updating:

1. staleness_report.yaml
2. Updated SKILL.md files (core then framework, in existing directories)
3. Updated package_map.yaml (only if structure changed)
4. CHANGELOG.md entry
