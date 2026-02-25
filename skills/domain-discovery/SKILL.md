---
name: skill-domain-discovery
description: >
  Analyze library documentation and source code, then interview maintainers
  to discover capability domains and generate a structured domain map for
  AI coding agent skills. Activate when creating skills for a new library,
  organizing existing documentation into skill categories, or when a
  maintainer wants help deciding how to structure their library's agent-facing
  knowledge. Produces a domain_map.yaml and skill_spec.md that feed directly
  into the skill-tree-generator skill.
metadata:
  version: "2.1"
  category: meta-tooling
  output_artifacts:
    - domain_map.yaml
    - skill_spec.md
  skills:
    - skill-tree-generator
---

# Domain Discovery & Maintainer Interview

You are extracting domain knowledge for a library to produce a structured
domain map. Your job is not to summarize documentation — it is to build a
deep understanding of the library first, then use that understanding to
surface the implicit knowledge that maintainers carry but docs miss.

There are four phases. Always run them in order. Phases 1–2 are autonomous.
Phase 3 is an interview that builds on what you learned. Phase 4 produces
the final artifacts.

---

## Phase 1 — Read everything (autonomous)

Read the library's documentation and source code. You are collecting raw
material — not reasoning about structure yet.

### Reading order

Read in this exact order. Each step builds context for the next.

1. **README and overview** — establishes vocabulary and core mental model
2. **Getting started / quickstart** — reveals the happy path and setup
3. **Every narrative guide** — the how-to content, not API reference tables
4. **Migration guides** — highest-yield source for failure modes; every
   breaking change is exactly what agents trained on older versions produce
5. **API reference** — scan for exports, type signatures, option shapes
6. **Changelog for major versions** — API renames, removed exports,
   behavioral changes
7. **GitHub issues and discussions** — scan for frequently reported
   confusion, common misunderstandings, recurring questions. Also look
   for what users are implicitly arguing for architecturally — not just
   "people are confused about X" but "users keep expecting X to work
   like Y, which reveals a tension between [design force] and [design force]"
8. **Source code** — verify ambiguities from docs, check defaults, find
   assertions and invariant checks

### What to log

Produce a flat concept inventory. One item per line. No grouping yet.

Log every:
- Named concept, abstraction, or lifecycle stage
- Public export: function, hook, class, type, constant
- Configuration key, its type, and its default value
- Constraint or invariant (especially any enforced by `throw` or assertion)
- Doc callout: any "note", "warning", "caution", "important", "avoid", "do not"
- Dual API: any place the library has two ways to do the same thing (old/new,
  verbose/shorthand, lower-level/higher-level)
- Environment branch: any place behavior depends on SSR/CSR, dev/prod,
  framework, bundler, or config flag
- Type gap: any type documented as accepting X but source shows X | Y or
  rejects a subtype of X
- Source assertion: any `if (!x) throw`, `invariant()`, or `assert()` with
  the error message text

### What to extract from migration guides specifically

For each breaking change between major versions:

```
Old pattern: [code that agents trained on older versions will produce]
New pattern: [current correct code]
What changed: [one sentence — the specific mechanism]
Version boundary: [e.g. "v4 → v5"]
```

These become high-priority failure modes in Phase 2.

---

## Phase 2 — Draft domain map (autonomous)

You now have the concept inventory. Derive domains and failure modes from
it before involving the maintainer.

### 2a — Group the concept inventory

Move items into groups. Two items belong together when:
- A developer reasons about them together when solving a problem
- Solving one correctly requires understanding how the other works
- They share a lifecycle, configuration scope, or architectural tradeoff
- Getting one wrong tends to produce bugs in the other

**Merge aggressively.** Target 4–7 domains. 5 sharp domains beats 12 thin ones.

Do not create a group for:
- A single hook, function, or class
- A single doc or reference page
- "Miscellaneous", "Advanced", or "Other"
- Configuration knobs that only affect another group's behavior

### 2b — Validate every group

For each group:

> "Can a developer perform three or more meaningfully different tasks using
> the same mental model this group represents?"

If no — merge it with the closest related group.

### 2c — Flag subsystems within domains

After grouping, check each domain for internal diversity. A domain may
be conceptually unified (one mental model) but contain multiple
independent subsystems with distinct config interfaces — for example,
5 sync adapters that all solve "connectivity" but each with unique
setup, options, and failure modes.

For each domain, ask: "Does this domain contain 3+ backends, adapters,
drivers, or providers that share a purpose but have distinct
configuration surfaces?" If yes, list them as `subsystems` on the
domain. These tell the skill-tree-generator to produce per-subsystem
reference files rather than compressing everything into one skill.

Also flag domains with dense API surfaces — if a single topic within
the domain has >10 distinct operators, option shapes, or patterns
(e.g. query operators, schema validation rules), note it as a
`reference_candidates` entry. These need dedicated reference files
for agents to have enough detail for implementation.

### 2d — Name each group as a capability domain

Names describe work being performed, not what the library provides:

| If your name is... | It is wrong because... | Rewrite as... |
|---------------------|------------------------|---------------|
| A function/hook name | Feature-oriented | The work the function enables |
| A doc section title | Mirrors existing structure | The developer intent it serves |
| A noun phrase | Describes a thing, not work | Verb phrase or lifecycle name |
| "Configuration" | Too generic | The specific config scope |

### 2e — Extract failure modes from docs and source

For each domain, extract failure modes that pass all three tests:

- **Plausible** — An agent would generate this because it looks correct
  based on the library's design, a similar API, or an older version
- **Silent** — No immediate crash; fails at runtime or under specific conditions
- **Grounded** — Traceable to a specific doc page, source location, or issue

**Where to find them:**

| Source | What to extract |
|--------|----------------|
| Migration guides | Every breaking change → old pattern is the wrong code |
| Doc callouts | Any "note", "warning", "avoid" with surrounding context |
| Source assertions | `throw` and `invariant()` messages describe the failure |
| Default values | Undocumented or surprising defaults that cause wrong behavior |
| Type precision | Source type more restrictive than docs imply |
| Environment branches | `typeof window`, SSR flags, `NODE_ENV` — behavior differs silently |

Target 3 failure modes per domain minimum. Complex domains target 5–6.

**Cross-domain failure modes.** Some failure modes belong to multiple
domains. A developer doing SSR work and a developer doing state management
both need to know about "stale state during hydration" — they load
different skills but need the same advice. When a failure mode spans
domains, list all relevant domain slugs in its `domains` field. The
skill-tree-generator will write it into every corresponding SKILL file.

Do not force failure modes into a single domain for tidiness. If the
advice is needed by someone working in domain A and also by someone
working in domain B, it belongs in both.

### 2f — Identify cross-domain tensions

Look for places where design forces between domains conflict. A tension
is not a failure mode — it's a structural pull where getting one domain
right makes another domain harder. Examples:

- "Getting-started simplicity conflicts with production operational safety"
- "Type-safety strictness conflicts with rapid prototyping flexibility"
- "SSR correctness requires patterns that hurt client-side performance"

Tensions are where agents fail most because they optimize for one domain
without seeing the tradeoff. Each tension should name the domains in
conflict, describe the pull, and state what an agent gets wrong when it
only considers one side.

Target 2–4 tensions. If you find none, the domains may be too isolated —
revisit whether you're missing cross-connections.

### 2g — Identify gaps

For each domain, explicitly list what you could NOT determine from docs
and source alone. These become interview questions in Phase 3.

Common gaps:
- "Docs describe X but don't explain when you'd choose X over Y"
- "Migration guide mentions this changed but doesn't say what the old
  behavior was"
- "Source has an assertion here but no doc explains what triggers it"
- "GitHub issues show confusion about X but docs don't address it"
- "I found two patterns for doing X — unclear which is current/preferred"

### 2h — Discover composition targets

Scan `package.json` for peer dependencies, optional dependencies, and
`peerDependenciesMeta`. Scan example directories and integration tests
for import patterns. For each frequently co-used library, log:

- Library name and which features interact
- Whether it's a required or optional integration
- Any example code showing the integration pattern

These become targeted composition questions in Phase 3f.

### 2i — Produce the draft domain map

Write the full `domain_map.yaml` (format in Output Artifacts below) with
a `status: draft` field. Flag every gap in the `gaps` section.

Present the draft to the maintainer before starting the interview:

> "I've read the docs and source for [library] and produced a draft domain
> map with [N] domains and [M] failure modes. Before we start the interview,
> review this draft. I've flagged [K] specific gaps where I need your input."

---

## Phase 3 — Maintainer interview (builds on Phase 1–2)

You have already read everything and formed a draft. The interview fills
gaps, validates your understanding, and surfaces implicit knowledge.

### Rules for the interview

1. One topic per message for open-ended questions. You may batch 2–3
   yes/no or short-confirmation questions in a single message when they
   are factual checks (e.g. "Is X still the recommended pattern? Does Y
   default apply in production? Is Z deprecated?"). Reserve single-question
   format for any question requiring explanation or nuance.
2. Each question must reference something specific from your reading.
3. If the maintainer gives a short answer, probe deeper before moving on.
4. Take notes silently. Do not summarize back unless asked.

### 3a — Draft review (2–3 questions)

Start by confirming or correcting your draft:

> "I've organized [library] into [N] domains. Here's my proposed grouping:
> [list domains with brief descriptions]. Does this match how you think
> about your library? What would you move, merge, or split?"

Follow up on any corrections. Then:

> "I identified [M] failure modes from the docs and migration guides. Are
> there important ones I missed — especially patterns that look correct
> but fail silently?"

### 3b — Gap-targeted questions (3–8 questions)

For each gap flagged in Phase 2, ask a specific question. These are not
generic — they reference what you found:

**Instead of:** "What do developers get wrong?"
**Ask:** "I noticed the migration guide from v4 to v5 changed how [X] works,
but the docs don't show the old pattern. Do agents still commonly generate
the v4 pattern? What does it look like?"

**Instead of:** "Are there surprising interactions?"
**Ask:** "The source throws an invariant error if [X] is called before [Y],
but the docs don't mention ordering. How often do developers hit this?"

**Instead of:** "What's different in SSR vs client?"
**Ask:** "I found a `typeof window` check in [file] that changes behavior
for [feature]. What goes wrong when developers test only in the browser
and deploy with SSR?"

Adapt from this bank of gap-targeted question templates:

- "I found two patterns for [X] in the docs — [pattern A] and [pattern B].
  Which is current, and does the old one still work?"
- "The source defaults [config option] to [value], which seems surprising
  for [reason]. Is this intentional? Do developers need to override it?"
- "GitHub issues show [N] reports of confusion about [X]. What's the
  underlying misunderstanding?"
- "I couldn't find docs for how [feature A] interacts with [feature B].
  What should an agent know about using them together?"
- "The API reference shows [type signature], but the guide examples use
  a different shape. Which is accurate?"

### 3c — AI-agent-specific failure modes (2–4 questions)

These target mistakes that AI coding agents make but human developers
typically don't. Agent-specific failures are often the highest-value
findings — in testing, maintainer answers to these questions produced
the most critical failure modes.

- "What mistakes would an AI coding agent make that a human developer
  wouldn't? Think about: hallucinating APIs that don't exist, defaulting
  to language primitives instead of library abstractions, choosing the
  wrong adapter or integration path."
- "When an agent generates code using your library, what's the first
  thing you'd check? What pattern would make you immediately say
  'an AI wrote this'?"
- "Are there parts of your API where the naming or design is misleading
  enough that an agent with no prior context would pick the wrong
  approach? What would it pick, and what should it pick instead?"
- "Are there features where the docs are comprehensive for human
  developers but would still mislead an agent? For example, features
  that require understanding unstated context, or where the 'obvious'
  approach from reading the API surface is wrong."

### 3d — Implicit knowledge extraction (3–5 questions)

These surface knowledge that doesn't appear in any docs:

- "What does a senior developer using your library know that a mid-level
  developer doesn't — something that isn't written down anywhere?"
- "Are there patterns that work fine for prototyping but are dangerous
  in production? What makes them dangerous?"
- "What question do you answer most often in Discord or GitHub issues
  that the docs technically cover but people still miss?"
- "Is there anything you'd change about the API design if you could break
  backwards compatibility? What's the current workaround?"

### 3e — Composition questions (if library interacts with others)

Use what you discovered in Phase 2h. For each integration target
identified from peer dependencies and example code, ask targeted
questions:

- "I see [library] is a peer dependency and [N] examples import it
  alongside yours. What's the most common integration mistake?"
- "When developers use [your library] with [other library], are there
  patterns that only matter when both are present?"
- "I found [specific integration pattern] in the examples. Is this the
  recommended approach, or is there a better way that isn't documented?"

---

## Phase 4 — Finalize artifacts

Merge interview findings into the draft domain map. For each interview answer:

1. If it confirms a draft domain or failure mode — no action needed
2. If it corrects something — update the domain map
3. If it adds a new failure mode — add it with source "maintainer interview"
4. If it reveals a new domain — evaluate whether to add or merge
5. If it fills a gap — remove from gaps section

Update `status: draft` to `status: reviewed`.

---

## Output artifacts

### 1. domain_map.yaml

```yaml
# domain_map.yaml
# Generated by skill-domain-discovery
# Library: [name]
# Version: [version this map targets]
# Date: [ISO date]
# Status: [draft | reviewed]

library:
  name: "[package-name]"
  version: "[version]"
  repository: "[repo URL]"
  description: "[one line]"
  primary_framework: "[React | Vue | Svelte | framework-agnostic]"

domains:
  - name: "[work-oriented domain name]"
    slug: "[kebab-case]"
    description: "[what a developer is doing, not what the library provides]"
    covers:
      - "[API/hook/concept 1]"
      - "[API/hook/concept 2]"
    tasks:
      - "[example task 1]"
      - "[example task 2]"
      - "[example task 3]"
    subsystems:                    # omit if domain has no independent subsystems
      - name: "[adapter/backend name]"
        package: "[npm package if separate]"
        config_surface: "[brief description of unique config]"
    reference_candidates:          # omit if no dense API surfaces
      - topic: "[e.g. query operators, schema validation]"
        reason: "[e.g. >10 distinct operators with signatures]"
    failure_modes:
      - mistake: "[5-10 word phrase]"
        mechanism: "[one sentence]"
        source: "[doc page, source file, issue link, or maintainer interview]"
        priority: "[CRITICAL | HIGH | MEDIUM]"
        status: "[active | fixed-but-legacy-risk | removed]"
        version_context: "[e.g. 'Fixed in v5.2 but agents trained on older code still generate this']"
        domains: ["[this-domain-slug]"]  # list all domains this belongs to; omit if single-domain
    related_domains:
      - "[other domain slug this one references]"
    compositions:
      - library: "[other library name]"
        skill: "[composition skill name if applicable]"

tensions:
  - name: "[short phrase describing the pull]"
    domains: ["[domain-slug-a]", "[domain-slug-b]"]
    description: "[what conflicts — one sentence]"
    implication: "[what an agent gets wrong when it only considers one side]"

gaps:
  - domain: "[domain slug]"
    question: "[what still needs input]"
    context: "[why this matters]"
    status: "[open | resolved]"
```

### 2. skill_spec.md

A human-readable companion that includes:

- Library overview (2–3 sentences, no marketing)
- Domain table with coverage matrix
- Full failure mode inventory grouped by domain, distinguishing
  doc-sourced vs maintainer-sourced failure modes. Flag cross-domain
  failure modes and list which SKILL files each should appear in.
- Tensions inventory with the domains in conflict and agent implications
- Remaining gaps (if any) needing further input
- Recommended skill file structure: which domains become tier 1 stubs,
  which become tier 2 sub-skills, which need references/ directories
- Composition opportunities: which other libraries this one interacts
  with and what composition skills are needed

Format the domain table as:

```
| Domain | Skill name | What it covers | Failure modes | Tier |
|--------|------------|----------------|---------------|------|
| [name] | [lib]/[slug] | [exhaustive list] | [count] | [1|2] |
```

---

## Constraints

| Check | Rule |
|-------|------|
| Docs read before interview | Never start interviewing without completing Phase 1–2 |
| Batch only confirmations | Yes/no questions may batch 2–3; open-ended questions get their own message |
| Questions reference findings | No generic questions — cite what you found |
| 4–7 domains | Merge aggressively; 5 sharp domains > 12 thin ones |
| Work-oriented names | No function names, no doc section titles |
| 3+ failure modes per domain | Complex domains target 5–6 |
| Every failure mode sourced | Doc page, source file, issue link, or maintainer interview |
| Gaps are explicit | Unknown areas flagged, not guessed |
| No marketing prose | Library description is factual, not promotional |
| domain_map.yaml is valid YAML | Parseable by any YAML parser |
| Draft before interview | Always present draft for review first |
| Agent-specific failures probed | Always ask AI-agent-specific questions in Phase 3c |
| Compositions discovered from code | Scan peer deps and examples before asking composition questions |
| Cross-domain failure modes tagged | Failure modes spanning domains list all relevant slugs in `domains` |
| Tensions identified | 2–4 cross-domain tensions; if none found, revisit domain boundaries |
| Subsystems flagged | Domains with 3+ adapters/backends list them as subsystems |
| Dense surfaces flagged | Topics with >10 patterns noted as reference_candidates |

---

## Cross-model compatibility notes

This skill is designed to produce consistent results across Claude, GPT-4+,
Gemini, and open-source models. To achieve this:

- All instructions use imperative sentences, not suggestions
- Output formats use YAML (universally parsed) and Markdown tables
  (universally rendered)
- Examples use concrete values, not placeholders like "[your value here]"
- Section boundaries use Markdown headers (##) for navigation and --- for
  phase separation
- No model-specific features (no XML tags in output, no tool_use assumptions)
