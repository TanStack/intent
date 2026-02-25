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
  version: "3.0"
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
The primary consumer of your output is AI coding agents, not humans —
prioritize failure modes that agents make over ones that only humans make.

There are four phases. Always run them in order. Phases 1–2 are autonomous.
Phase 3 is an interview that builds on what you learned. Phase 4 produces
the final artifacts.

---

## Phase 1 — Read and triage (autonomous)

Read the library's documentation and source code. You are collecting raw
material — not reasoning about structure yet.

### 1a — Initial read

Read in this exact order:

1. **README and overview** — establishes vocabulary and core mental model
2. **Getting started / quickstart** — reveals the happy path and setup
3. **package.json** — scan `dependencies`, `peerDependencies`, and
   `devDependencies` for composition targets (other libraries this one
   integrates with). Log every external library that appears.

### 1b — Triage (for libraries with multiple packages or adapters)

After the initial read, identify:
- **Core packages** — the main library logic (e.g. `@tanstack/router-core`)
- **Framework adapters** — bindings for specific frameworks (e.g.
  `@tanstack/react-router`, `@tanstack/solid-router`)
- **Integration packages** — adapters for external services or libraries

**Reading strategy by package type:**

| Package type | Reading depth |
|-------------|--------------|
| Core | Read exhaustively — every guide, every API doc, full source scan |
| First framework adapter | Read exhaustively — this is the reference adapter |
| Other framework adapters | Scan for deviations from the first adapter only |
| Integration packages | Read overview + API surface. Deep read only if conceptually distinct |

If the library has only one package or no framework adapters, skip triage
and read everything.

### 1c — Deep read (following triage priority)

Continue reading in this order, applying triage depth:

3. **Every narrative guide** — the how-to content, not API reference tables
4. **Migration guides** — highest-yield source for failure modes; every
   breaking change is exactly what agents trained on older versions produce
5. **API reference** — scan for exports, type signatures, option shapes
6. **Changelog for major versions** — API renames, removed exports,
   behavioral changes. Pay special attention to bug fix entries — each
   describes a failure mode with enough detail to reconstruct wrong code
7. **GitHub issues and discussions** — scan for frequently reported
   confusion, common misunderstandings, recurring questions
8. **Source code** — verify ambiguities from docs, check defaults, find
   assertions and invariant checks. Grep for `throw new`, `invariant()`,
   and `assert()` — named error classes often map directly to developer
   mistakes
9. **Example code in the repo** — scan `/examples` directory for patterns
   the library recommends. Note which external libraries appear in examples
   (these are composition targets).

### 1d — What to log

Produce a flat concept inventory. One item per line. No grouping yet.

Log every:
- Named concept, abstraction, or lifecycle stage
- Public export: function, hook, class, type, constant
- Configuration key, its type, and its default value
- Constraint or invariant (especially any enforced by `throw` or assertion)
- Doc callout: any "note", "warning", "caution", "important", "avoid"
- Dual API: any place the library has two ways to do the same thing
- Environment branch: any place behavior depends on SSR/CSR, dev/prod,
  framework, bundler, or config flag
- Type gap: any type documented as accepting X but source shows X | Y
- Source assertion: any `if (!x) throw` with the error message text
- Composition target: every external library found in package.json deps,
  peer deps, examples, or docs

### 1e — What to extract from migration guides and changelogs

For each breaking change between major versions:

```
Old pattern: [code that agents trained on older versions will produce]
New pattern: [current correct code]
What changed: [one sentence — the specific mechanism]
Version boundary: [e.g. "v4 → v5"]
Status: [active | fixed-but-legacy-risk]
```

Status meanings:
- **active** — This is still a problem in the current version
- **fixed-but-legacy-risk** — Bug was fixed, but agents trained on older
  code may still generate the old pattern

For changelog bug fixes:

```
Bug: [what went wrong]
Wrong code: [code that triggers the bug, if reconstructible]
Fix version: [version that fixed it]
Status: [fixed-but-legacy-risk | fixed]
```

Mark as `fixed-but-legacy-risk` if agents are likely to have seen the
buggy pattern in training data. Mark as `fixed` if the bug was obscure
enough that agents are unlikely to reproduce it.

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

**Merge aggressively.** Target 4–7 domains. 5 sharp domains beats 12.

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

### 2c — Name each group as a capability domain

Names describe work being performed, not what the library provides:

| If your name is... | It is wrong because... | Rewrite as... |
|---------------------|------------------------|---------------|
| A function/hook name | Feature-oriented | The work the function enables |
| A doc section title | Mirrors existing structure | The developer intent it serves |
| A noun phrase | Describes a thing, not work | Verb phrase or lifecycle name |
| "Configuration" | Too generic | The specific config scope |

### 2d — Extract failure modes from docs and source

For each domain, extract failure modes that pass all three tests:

- **Plausible** — An agent would generate this because it looks correct
- **Silent** — No immediate crash; fails at runtime or conditionally
- **Grounded** — Traceable to a specific doc page, source, or issue

**Where to find them:**

| Source | What to extract |
|--------|----------------|
| Migration guides | Every breaking change → old pattern is the wrong code |
| Changelogs | Bug fixes → reconstruct the wrong code that triggered the bug |
| Doc callouts | Any "note", "warning", "avoid" with surrounding context |
| Source assertions | `throw` and `invariant()` messages describe the failure |
| Default values | Undocumented or surprising defaults that cause wrong behavior |
| Type precision | Source type more restrictive than docs imply |
| Environment branches | `typeof window`, SSR flags — behavior differs silently |

Target 3 failure modes per domain minimum. Complex domains target 5–6.

### 2e — Identify AI-agent-specific failure modes

Beyond developer mistakes, explicitly look for mistakes that AI coding
agents make but humans rarely would:

| Agent-specific pattern | What to look for |
|----------------------|-----------------|
| API hallucination | Functions with similar names to popular libraries but different signatures |
| Language primitive default | Places where agents would use JS/TS builtins instead of library features (e.g. `.filter()` instead of query operators) |
| Wrong abstraction layer | Multiple ways to do something at different levels (agents pick the wrong one) |
| Mutation API confusion | Update APIs that use drafts/proxies instead of spread/assign |
| Adapter selection | Multiple adapters where agents default to the wrong one |
| Config shape hallucination | Options objects where agents guess plausible but wrong keys |

For each, log:
```
Agent mistake: [what the agent would generate]
Correct: [what it should generate]
Why agents get this wrong: [one sentence — training data bias, API similarity, etc.]
```

These are high-priority candidates for CRITICAL failure modes.

### 2f — Identify composition opportunities

From the composition targets logged in Phase 1 (package.json deps, peer
deps, example imports), identify:

- Which external libraries appear most frequently
- Which compositions are documented vs undocumented
- Which compositions have known integration pitfalls

For each composition target:
```
Library: [name]
Frequency: [how often it appears in deps/examples]
Documented: [yes | partially | no]
Known pitfalls: [any integration issues found in docs/issues]
```

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

### 2h — Produce the draft domain map

Write the full `domain_map.yaml` (format in Output Artifacts below) with
`status: draft`. Flag every gap in the `gaps` section.

Present the draft to the maintainer before starting the interview:

> "I've read the docs and source for [library] and produced a draft domain
> map with [N] domains and [M] failure modes. Before we start the interview,
> review this draft. I've flagged [K] specific gaps where I need your input."

---

## Phase 3 — Maintainer interview (builds on Phase 1–2)

You have already read everything and formed a draft. The interview fills
gaps, validates your understanding, and surfaces implicit knowledge —
especially knowledge about how AI agents specifically fail with this library.

### Rules for the interview

1. Ask one question per message for open-ended exploration questions.
2. You may batch 2–3 simple confirmation questions (yes/no, still relevant?,
   which is current?) in a single message when probing factual items.
   Never batch open-ended questions.
3. Each question must reference something specific from your reading.
4. If the maintainer gives a short answer, probe deeper before moving on.
5. Take notes silently. Do not summarize back unless asked.
6. If the maintainer says "the docs are comprehensive" for a topic, pivot
   to AI-agent-specific questions — docs being comprehensive for humans
   does not mean they prevent agent mistakes.

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

### 3c — AI-agent-specific failure modes (3–5 questions)

These are the highest-value questions in the interview. AI agents make
systematically different mistakes from human developers. Push hard here.

- "If an AI coding agent were generating code for your library right now,
  what's the first mistake you'd expect it to make?"
- "Are there places where an agent would likely use a JavaScript/TypeScript
  primitive (like `.filter()`, `.map()`, or object spread) instead of your
  library's built-in feature? What should it use instead?"
- "Your library has [N] ways to do [X] — [list them]. Which one do agents
  pick by default, and which one should they pick?"
- "Are there API signatures that look similar to a popular library
  (React Query, Redux, etc.) but behave differently? What would an agent
  assume incorrectly?"
- "What API would an agent most likely hallucinate — something that looks
  like it should exist based on the library's patterns, but doesn't?"

### 3d — Implicit knowledge extraction (2–3 questions)

These surface knowledge that doesn't appear in any docs:

- "What does a senior developer using your library know that a mid-level
  developer doesn't — something that isn't written down anywhere?"
- "Are there patterns that work fine for prototyping but are dangerous
  in production? What makes them dangerous?"
- "Is there anything you'd change about the API design if you could break
  backwards compatibility? What's the current workaround?"

### 3e — Composition questions (targeted, not generic)

Use the composition targets identified in Phase 1 (from package.json and
examples). Ask about specific libraries, not generic "what do you compose
with":

- "I see [library X] appears in your peer dependencies and in [N] examples.
  What's the most common integration mistake when using [your library]
  with [library X]?"
- "Is there an integration pattern between [your library] and [library X]
  that only matters when both are present? Something an agent wouldn't
  know from reading each library's docs independently?"
- "When [your library] and [library X] are used together, are there
  configuration conflicts or ordering requirements?"

If no composition targets were found in Phase 1, ask:
- "Which other libraries does yours compose with most often in real
  projects?"

---

## Phase 4 — Finalize artifacts

Merge interview findings into the draft domain map.

For each interview answer:

1. If it confirms a failure mode → set `confidence: confirmed`
2. If it corrects something → update the domain map
3. If it adds a new failure mode → add with `source: "maintainer interview"`
   and `confidence: confirmed`
4. If it reveals a new domain → evaluate whether to add or merge
5. If it fills a gap → set gap status to `resolved`

For failure modes that were presented to the maintainer but not explicitly
discussed (neither confirmed nor contradicted), set `confidence: inferred`.

For failure modes extracted from docs/source that were never discussed in
the interview, set `confidence: unverified`.

Update `status: draft` to `status: reviewed`.

---

## Output artifacts

### 1. domain_map.yaml

```yaml
# domain_map.yaml
# Generated by skill-domain-discovery v3.0
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
  packages:
    core: ["[core package name]"]
    framework_adapters: ["[adapter 1]", "[adapter 2]"]
    integrations: ["[integration package]"]

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
    failure_modes:
      - mistake: "[5-10 word phrase]"
        mechanism: "[one sentence]"
        source: "[doc page, source file, issue link, or maintainer interview]"
        priority: "[CRITICAL | HIGH | MEDIUM]"
        confidence: "[confirmed | inferred | unverified]"
        status: "[active | fixed-but-legacy-risk | fixed]"
        agent_specific: [true | false]
    related_domains:
      - "[other domain slug]"
    compositions:
      - library: "[other library name]"
        frequency: "[how often seen in deps/examples]"
        documented: "[yes | partially | no]"
        known_pitfalls: "[brief description or none]"
        skill: "[composition skill name if applicable]"

gaps:
  - domain: "[domain slug]"
    question: "[what still needs input]"
    context: "[why this matters]"
    status: "[open | resolved]"
```

### 2. skill_spec.md

A human-readable companion that includes:

- Library overview (2–3 sentences, no marketing)
- Package structure: core, framework adapters, integrations
- Domain table with coverage matrix
- Full failure mode inventory grouped by domain, distinguishing:
  - Doc-sourced vs maintainer-sourced
  - Confirmed vs inferred vs unverified
  - Active vs fixed-but-legacy-risk
  - Agent-specific vs general
- Remaining gaps (if any) needing further input
- Recommended skill file structure: which domains become core skills,
  which become framework skills, which need sub-skills, which need
  references/ directories
- Composition opportunities: which libraries, how frequently they
  compose, what skills are needed

Format the domain table as:

```
| Domain | Skill name | What it covers | Failure modes | Confidence |
|--------|------------|----------------|---------------|------------|
| [name] | [lib]/[slug] | [list] | [confirmed/inferred/unverified counts] | [breakdown] |
```

---

## Constraints

| Check | Rule |
|-------|------|
| Docs read before interview | Never start interviewing without completing Phase 1–2 |
| Triage before deep read | For multi-package libraries, identify core vs adapters first |
| One question per message (exploration) | Open-ended questions are never batched |
| May batch 2–3 confirmations | Only yes/no or factual verification questions |
| Questions reference findings | No generic questions — cite what you found |
| AI-agent failure modes explicitly sought | Phase 2e + Phase 3c are mandatory |
| 4–7 domains | Merge aggressively; 5 sharp domains > 12 thin ones |
| Work-oriented names | No function names, no doc section titles |
| 3+ failure modes per domain | Complex domains target 5–6 |
| Every failure mode sourced | Doc page, source file, issue link, or maintainer interview |
| Every failure mode has confidence | confirmed, inferred, or unverified |
| Every failure mode has status | active, fixed-but-legacy-risk, or fixed |
| Gaps are explicit | Unknown areas flagged, not guessed |
| Compositions identified from deps | Not just from interview |
| No marketing prose | Library description is factual, not promotional |
| domain_map.yaml is valid YAML | Parseable by any YAML parser |
| Draft before interview | Always present draft for review first |

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
