### Step 2 — Write the core skill

The core skill is the foundational overview for the library. It covers
framework-agnostic concepts and contains the sub-skill registry.

**Frontmatter:**

```yaml
---
name: '[lib]-core'
description: >
  [1–3 sentences. What this library does and the framework-agnostic
  concepts it provides. Pack with keywords: function names, config
  options, concepts. This is a routing key, not a human summary.]
metadata:
  type: core
  library: '[lib]'
  library_version: '[version this targets]'
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
name: '[domain-slug]'
description: >
  [1–3 sentences. What this domain covers AND when to load it. Name
  specific functions, options, or APIs. Dense routing key.]
metadata:
  type: sub-skill
  library: '[lib]'
  library_version: '[version]'
sources:
  - '[repo]:docs/[path].md'
  - '[repo]:src/[path].ts'
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
name: 'react-[lib]'
description: >
  [1–3 sentences. React-specific bindings for [library]. Name the hooks,
  components, and providers. Mention React-specific patterns like SSR
  hydration if applicable.]
metadata:
  type: framework
  library: '[lib]'
  framework: react
  library_version: '[version]'
requires:
  - '[lib]-core'
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
name: '[domain-slug]'
description: >
  [React-specific description for this domain.]
metadata:
  type: sub-skill
  library: '[lib]'
  framework: react
  library_version: '[version]'
requires:
  - '[lib]-core'
  - '[lib]-core/[domain-slug]'
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

Also check the domain map's `cross_references` section for non-tension
relationships between skills. For each cross-reference, add a "See also"
line at the end of the relevant skill's body:

```markdown
See also: [other-skill]/SKILL.md — [reason]
```

### Step 6 — Write composition skills (if applicable)

Use the `compositions` entries from `domain_map.yaml` (populated during
domain-discovery Phase 3h) to identify which composition skills
to produce.

Composition skills cover how two or more libraries work together. These
are framework-specific by default (the integration patterns depend on
framework hooks and providers).

**Frontmatter:**

```yaml
---
name: '[lib-a]-[lib-b]'
description: >
  [How lib-a and lib-b wire together. Name the specific integration
  points: functions, hooks, patterns.]
metadata:
  type: composition
  library_version: '[version of primary lib]'
requires:
  - '[lib-a]-core'
  - 'react-[lib-a]'
  - '[lib-b]-core'
  - 'react-[lib-b]'
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
name: security
description: >
  Go-live security validation for [library]. Checks [specific concerns].
metadata:
  type: security
  library: '[lib]'
  framework: react
  library_version: '[version]'
requires:
  - 'react-[lib]'
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

```

The key differences from the standard body:
- No "Setup" section — the agent already has the app running
- Checks replace "Core Patterns" — each check is a verification, not a
  teaching pattern
- The summary checklist at the end gives agents a quick pass/fail list
- Common Mistakes section is still present for wrong/correct pairs
```
