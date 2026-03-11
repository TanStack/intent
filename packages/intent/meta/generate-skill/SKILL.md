---
name: skill-generate
description: >
  Generate a complete SKILL.md file for a library from source documentation
  and skill tree artifacts. Activate when bootstrapping skills for a new
  library, regenerating a stale skill after source changes, or producing a
  skill from a skill_tree.yaml entry. Takes a skill name, description, and
  source docs as inputs; outputs a validated SKILL.md that conforms to the
  tree-generator spec.
metadata:
  version: '1.0'
  category: meta-tooling
  input_artifacts:
    - skills/_artifacts/skill_tree.yaml
    - skills/_artifacts/domain_map.yaml
    - skills/_artifacts/skill_spec.md
    - source documentation
  output_artifacts:
    - SKILL.md
  skills:
    - skill-tree-generator
    - skill-domain-discovery
---

# Skill Generation

You are generating a SKILL.md file for the `@tanstack/intent` agent skills
repo. Skills in this repo are written for coding agents (Claude Code, Cursor,
Copilot, Warp Oz, Codex), not for human readers. Your output will be loaded
into an agent's context window and used to guide code generation.

There are two modes. Detect which applies.

**Mode A — Generate from domain map:** A `domain_map.yaml` and `skill_spec.md`
exist. Generate the skill specified by name from these artifacts plus the
source documentation they reference.

**Mode B — Generate from raw docs:** No domain map exists. Generate directly
from source documentation provided as input.

---

## Inputs

You will receive:

If the maintainer uses a custom skills root, replace `skills/` in any paths
below with their chosen directory.

**Monorepo:** When the skill tree entry has a `package` field, write the
SKILL.md into that package's skills directory (e.g.
`packages/client/skills/core/SKILL.md`), not a shared root.

1. **Skill name** — format `library-group/skill-name` (e.g. `tanstack-query/core`,
   `tanstack-router/loaders`, `db/core/live-queries`)
2. **Skill description** — what the skill covers and when an agent should load it
3. **Source documentation** — the docs, guides, API references, and/or source
   files to distill from
4. **Domain map entry** (Mode A only) — the skill's entry from `domain_map.yaml`
   including failure modes, subsystems, compositions, and source references

---

## Step 1 — Determine skill type

Read the inputs and classify the skill type:

| Type          | When to use                                                |
| ------------- | ---------------------------------------------------------- |
| `core`        | Framework-agnostic concepts, configuration, patterns       |
| `sub-skill`   | A focused sub-topic within a core or framework skill       |
| `framework`   | Framework-specific bindings, hooks, components             |
| `lifecycle`   | Cross-cutting developer journey (getting started, go-live) |
| `composition` | Integration between two or more libraries                  |
| `security`    | Audit checklist or security validation                     |

The skill type determines the frontmatter and body structure. See
skill-tree-generator for the full spec of each type.

---

### Subagent guidance for batch generation

When generating multiple skills, spawn a separate subagent for each skill
(or per-package group). Each subagent receives the domain_map.yaml,
skill_tree.yaml, and the source docs relevant to its skill. This prevents
context bleed between skills and allows parallel generation.

---

## Step 2 — Extract content from sources

**Line budget:** Each SKILL.md must stay under 500 lines. Before writing,
estimate the content size. If a skill has 5+ failure modes, 3+ primary
patterns, and subsystem details, proactively plan reference files during
extraction — don't wait until the skill exceeds the limit.

Read through the source documentation. Extract only what a coding agent
cannot already know:

### What to extract

- **API shapes** — function signatures, hook parameters, option objects,
  return types. Use the actual TypeScript types from source.
- **Setup patterns** — minimum viable initialization code
- **Primary patterns** — the 2–4 most important usage patterns
- **Configuration** — defaults that matter, options that change behavior
- **Failure modes** — patterns that look correct but break. Prioritize:
  - Migration-boundary mistakes (old API that agents trained on older data produce)
  - Silent failures (no crash, wrong behavior)
  - Framework-specific gotchas (hydration, hook rules, provider ordering)
- **Constraints and invariants** — ordering requirements, lifecycle rules,
  things enforced by runtime assertions
- **Issue/discussion-sourced patterns** — real developer mistakes and
  confusion surfaced from GitHub issues and discussions (see below)

### 2b — Scan GitHub issues and discussions

Before writing the skill body, search the library's GitHub repo for issues
and discussions relevant to THIS skill's topic. This step is important for
both initial generation and regeneration — community feedback reveals
failure modes that docs miss.

**Search strategy:**

1. Search issues for the skill's primary APIs, hooks, and config options
   by name (e.g. `useQuery invalidation`, `createRouter middleware`)
2. Filter to high-signal threads: sort by reactions/comments, focus on
   closed bugs with workarounds and open questions with long threads
3. Search Discussions (if the repo uses them) for "how do I…" threads
   related to the skill's topic
4. Check for issues labeled `bug`, `question`, `breaking-change` that
   mention concepts this skill covers

**What to incorporate:**

- **Recurring bug workarounds** → add as Common Mistakes entries with
  wrong/correct code pairs. Cite the issue URL in the `Source` field.
- **Frequently asked questions** → if the answer is non-obvious, add it
  to Core Patterns or as a dedicated pattern section
- **Misunderstandings about defaults** → add to Common Mistakes with the
  incorrect assumption as the "wrong" pattern
- **Resolved issues that changed behavior** → if the old behavior is
  still in agent training data, add as a migration-boundary mistake

**What NOT to incorporate:**

- One-off bugs already fixed with no broader pattern
- Feature requests for APIs that don't exist yet
- Issues about tooling, CI, or build that don't affect library usage
- Stale threads (>2 years old) about behavior that has fundamentally changed

**Fallback:** If no web access is available, check for FAQ.md,
TROUBLESHOOTING.md, or docs/faq in the repo. Also check whether the
domain_map.yaml already contains issue-sourced failure modes from
domain-discovery — use those directly.

### What NOT to extract

- TypeScript basics, React hooks concepts, general web dev knowledge
- Marketing copy, motivational prose, "why this library is great"
- Exhaustive API tables (move these to `references/` if needed)
- Content that duplicates another skill (reference it instead)

---

## Step 3 — Write the frontmatter

### Core skill frontmatter

```yaml
---
name: [library]/[skill-name]
description: >
  [1–3 sentences. What this skill covers and exactly when an agent should
  load it. Written for the agent — include the keywords an agent would
  encounter when it needs this skill. Dense routing key.]
type: core
library: [library]
library_version: "[version this targets]"
sources:
  - "[Owner/repo]:docs/[path].md"
  - "[Owner/repo]:src/[path].ts"
---
```

### Sub-skill frontmatter

```yaml
---
name: [library]/[parent]/[skill-name]
description: >
  [1–3 sentences. What this sub-topic covers and when to load it.]
type: sub-skill
library: [library]
library_version: "[version]"
sources:
  - "[Owner/repo]:docs/[path].md"
---
```

### Framework skill frontmatter

```yaml
---
name: [library]/[framework]
description: >
  [1–3 sentences. Framework-specific bindings. Name the hooks, components,
  providers.]
type: framework
library: [library]
framework: [react | vue | solid | svelte | angular]
library_version: "[version]"
requires:
  - [library]/core
sources:
  - "[Owner/repo]:docs/framework/[framework]/[path].md"
---
```

### Frontmatter rules

- `description` must be written so the agent loads this skill at the right
  time — not too broad (triggers on everything) and not too narrow (never
  triggers). Pack with function names, option names, concept keywords.
- `sources` uses the format `Owner/repo:relative-path`. Glob patterns are
  supported (e.g. `TanStack/query:docs/framework/react/guides/*.md`).
- `library_version` is the version of the source library this skill targets.
- `requires` lists skills that must be loaded before this one.

---

## Step 4 — Write the body

### Standard body (core, sub-skill, framework)

Follow this section order exactly:

**1. Dependency note** (framework and sub-skills only)

```markdown
This skill builds on [parent-skill]. Read it first for foundational concepts.
```

**2. Setup**

A complete, copy-pasteable code block showing minimum viable usage.

- Real package imports with exact names (`@tanstack/react-query`, not `react-query`)
- No `// ...` or `[your code here]` — complete and runnable
- No unnecessary boilerplate — include exactly the context needed
- For framework skills: framework-specific setup (provider, hook wiring)
- For core skills: framework-agnostic setup (no hooks, no components)

**3. Core Patterns** (or "Hooks and Components" for framework skills)

2–4 patterns. For each:

- One-line heading: what it accomplishes
- Complete code block
- One sentence of explanation only if not self-explanatory

**4. Common Mistakes**

Minimum 3 entries. Complex skills target 5–6. Format:

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

Every mistake must be:
- **Plausible** — an agent would generate it
- **Silent** — no immediate crash
- **Grounded** — traceable to a doc page, source file, or issue

If the domain map includes failure modes with a `skills` list naming
multiple skills, include those failure modes in every SKILL file listed.

**5. References** (only when needed)

```markdown
## References

- [Full option reference](references/options.md)
````

Create reference files when the skill would exceed 500 lines, when the
domain covers 3+ independent adapters/backends, or when a topic has >10
distinct API patterns.

### Checklist body (security, go-live, audit)

Use when the primary action is "check these things" not "learn patterns":

````markdown
# [Library Name] — [Security | Go-Live] Checklist

Run through each section before [deploying | releasing].

## [Category] Checks

### Check: [what to verify]

Expected:

```[lang]
// correct configuration
```
````

Fail condition: [what indicates this check failed]
Fix: [one-line remediation]

## Common Security Mistakes

[Wrong/correct pairs, same format as standard Common Mistakes]

## Pre-Deploy Summary

- [ ] [Verification 1]
- [ ] [Verification 2]

```

---

## Step 5 — Validate

Run every check before outputting. Fix any failures.

| Check | Rule |
|-------|------|
| Under 500 lines | Move excess to references/ |
| Real imports in every code block | Exact package name, correct adapter |
| No external concept explanations | No "TypeScript is...", no "React hooks are..." |
| No marketing prose | No "powerful", "elegant", "best-in-class" |
| Every code block is complete | Works without modification when pasted |
| Common Mistakes are silent | Not obvious compile errors |
| Common Mistakes are library-specific | Not generic TS/React mistakes |
| Common Mistakes are sourced | Traceable to doc or source |
| `name` matches expected directory path | `db/core/live-queries` → `db/core/live-queries/SKILL.md` |
| `sources` filled for sub-skills | At least one Owner/repo:path |
| Framework skills have `requires` | Lists core dependency |
| Framework skills open with dependency note | First prose line references core |
| Description is a dense routing key | Not a human summary — agent-facing |

---

## Step 6 — Output

Before generating, ask the maintainer: "Would you like to review each skill
individually before I generate the next one, or should I generate all skills
and you review them together?" Respect their preference.

Output the complete SKILL.md file content. If reference files are needed,
output those as well with their relative paths.

If generating multiple skills in a batch (e.g. all skills for a library),
output in this order:

1. Core overview SKILL.md
2. Core sub-skills in domain order
3. Framework overview SKILL.md for each framework
4. Framework sub-skills
5. Composition skills
6. Security/checklist skills
7. Reference files

---

## Regeneration mode

When regenerating a stale skill (triggered by skill-staleness-check):

1. Read the existing SKILL.md and the source diff that triggered staleness
2. Scan GitHub issues and discussions opened since the skill was last
   generated (use `library_version` or file timestamps as the baseline).
   Look for new failure modes, resolved confusion, or changed patterns
   related to this skill's topic. Apply the same search strategy from
   Step 2b but scoped to the time window since last generation.
3. Determine which sections are affected by the source change AND by
   any new issue/discussion findings
4. Update only affected sections — preserve all other content
5. If a breaking change occurred, add the old pattern as a new Common
   Mistake entry (wrong/correct pair)
6. If issues/discussions reveal new failure modes not in the existing
   skill, add them to Common Mistakes with issue URLs as sources
7. Bump `library_version` in frontmatter
8. Validate the complete file against Step 5 checks

Do not rewrite the entire skill for a minor source change. Surgical
updates preserve review effort and reduce diff noise.

---

## Constraints

| Rule | Detail |
|------|--------|
| Match the library's framework support | Generate framework skills only for adapters the library actually provides. If the library supports only React, only generate React examples. If it supports multiple frameworks, generate one skill per adapter. |
| All imports use real package names | `@tanstack/react-query`, not `react-query` |
| No placeholder code | No `// ...`, `[your value]`, or `...rest`. Idiomatic framework patterns like `{children}` or `{props.title}` in JSX are not placeholders — they are real code and are acceptable. |
| Agent-first writing | Only write what the agent cannot already know |
| Examples are minimal | No unnecessary boilerplate or wrapper components |
| Failure modes are high-value | Focus on plausible-but-broken, not obvious errors |

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

## Meta-skill feedback

After generating all skills, run the `skill-feedback-collection` skill to
capture feedback about the scaffolding process (domain-discovery,
tree-generator, and generate-skill).
```
