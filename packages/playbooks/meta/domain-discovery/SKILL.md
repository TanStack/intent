---
name: skill-domain-discovery
description: >
  Analyze library documentation and source code, then interview maintainers
  to discover capability domains and task-focused skills for AI coding
  agents. Activate when creating skills for a new library, organizing
  existing documentation into skill categories, or when a maintainer wants
  help deciding how to structure their library's agent-facing knowledge.
  Produces a domain_map.yaml and skill_spec.md that feed directly into
  the skill-tree-generator skill.
metadata:
  version: '3.0'
  category: meta-tooling
  output_artifacts:
    - skills/_artifacts/domain_map.yaml
    - skills/_artifacts/skill_spec.md
  skills:
    - tree-generator
---

# Domain Discovery & Maintainer Interview

You are extracting domain knowledge for a library to produce a structured
domain map. Your job is not to summarize documentation — it is to build a
deep understanding of the library first, then use that understanding to
surface the implicit knowledge that maintainers carry but docs miss.

The output is a set of **task-focused skills** — each one matching a
specific developer moment ("implement a proxy", "set up auth", "audit
before launch"). Domains are an intermediate conceptual grouping you use
during analysis; the final skills emerge from the intersection of domains
and developer tasks.

There are five phases. Always run them in order.

1. **Quick scan** — orient yourself (autonomous)
2. **High-level interview** — extract the maintainer's task map
3. **Deep read** — fill in failure modes and detail (autonomous)
4. **Detail interview** — gap-targeted questions, AI-agent failures
5. **Finalize artifacts**

### Hard rules — interview phases are mandatory and interactive

These rules override any other reasoning. No exceptions.

1. **Phases 2 and 4 are interactive interviews conducted with the
   maintainer.** You must ask the questions specified in each sub-section
   and wait for the maintainer's response before continuing. Documentation,
   source code, and other automated analysis are NOT substitutes for the
   maintainer's answers.
2. **Every question in Phases 2 and 4 must be asked as an open-ended
   question and sent as a message to the maintainer.** You must then
   STOP and WAIT for their reply. Do not answer your own questions. Do
   not infer answers from documentation. Do not skip questions because
   you believe you already know the answer.
3. **Do not convert open-ended questions into multiple-choice,
   yes/no, or confirmation prompts.** The question templates in each
   sub-section are open-ended by design. Present them as open-ended
   questions. The maintainer's unprompted answers surface knowledge that
   pre-structured options suppress.
4. **Minimum question counts are enforced.** Each sub-section specifies
   a question count range (e.g. "2–4 questions"). You must ask at least
   the minimum number. Asking zero questions in any sub-section is a
   protocol violation.
5. **STOP gates are mandatory.** At the boundaries marked `── STOP ──`
   below, you must halt execution and wait for the maintainer's response
   or acknowledgment before proceeding. Do not continue past a STOP gate
   in the same message.
6. **If the maintainer asks to skip an interview phase**, explain the
   value of the phase and what will be lost. Proceed with skipping only
   if they confirm a second time.
7. **Rich documentation makes interviews MORE valuable, not less.**
   When docs are comprehensive, the interview surfaces what docs miss:
   implicit knowledge, AI-specific failure modes, undocumented tradeoffs,
   and the maintainer's prioritization of what matters most. Never
   rationalize skipping interviews because documentation is thorough.

---

## Phase 1 — Quick scan (autonomous, ~10 minutes)

Orient yourself in the library. You are building a structural map, not
reading exhaustively yet.

### 1a — Read orientation material

1. **README** — vocabulary, mental model, what the library does
2. **Getting started / quickstart** — the happy path
3. **Package structure** — if monorepo, identify which packages are
   client-facing vs internal. Focus on the 2–3 packages most relevant
   to skill consumers (usually client SDKs and primary framework adapters)
4. **AGENTS.md or .cursorrules** — if the library already has agent
   guidance, read it. This is high-signal for what the maintainer
   considers important

### 1b — Note initial impressions

Log (but do not group yet):

- What the library does in one sentence
- The core abstractions a developer interacts with
- Which frameworks it supports
- Any existing skill files, agent configs, or playbooks
- Whether the library is a monorepo and which packages matter
- Peer dependency constraints — read `peerDependencies` and
  `peerDependenciesMeta` from each client-facing package.json to
  understand version ranges and optional integrations early

Present your initial impressions to the maintainer as a brief summary
(3–5 bullets). This orients them on what you found and primes them for
the interview.

**── STOP ── Do not proceed to Phase 2 until the maintainer has
acknowledged your summary or responded.**

---

## Phase 2 — High-level interview (interactive — requires maintainer)

The maintainer's mental model of developer tasks IS the skill map. Your
job in this phase is to extract it — not to propose your own structure.

You must ask the questions below to the maintainer and wait for their
responses. Do not infer answers from documentation or source code.

### Rules for Phase 2

1. One topic per message for open-ended questions. You may batch 2–3
   yes/no or short-confirmation questions together.
2. Ask each question as written (you may adapt phrasing to context, but
   keep questions open-ended — never convert to multiple-choice).
3. Wait for the maintainer's response after each question before asking
   the next.
4. Take notes silently. Do not summarize back unless asked.
5. If the maintainer gives a short answer, probe deeper before moving on.

### 2a — Developer tasks (2–4 questions)

Start with the maintainer's view of what developers do:

> "Walk me through what a developer actually does with your library —
> not the elevator pitch, but the tasks they come to you for help with,
> from first install through production."

Follow up to enumerate distinct tasks:

> "If you listed every distinct thing a developer asks an agent to help
> with using your library, what would that list look like? I'm thinking
> things like 'set up the client', 'implement auth', 'debug sync issues'
> — each one a separate moment where they'd want focused guidance."

For monorepo libraries, also ask about cross-package tasks:

> "Are there tasks that touch multiple packages in your monorepo? For
> example, a getting-started flow that requires imports from both the
> client and server packages? I want to make sure skills that span
> package boundaries are captured correctly."

### 2b — Developer journeys (1–2 questions)

Surface lifecycle/journey skills that cross-cut task areas:

> "Are there developer journeys that cut across multiple features?
> For example: a getting-started guide, a go-to-production checklist,
> a migrate-from-v4 walkthrough. Which of these exist in your docs
> or would be valuable as standalone skills?"

### 2c — Composition and ecosystem (1–2 questions)

> "Which other libraries does yours compose with most often? Are there
> integration patterns important enough to warrant their own skill —
> for example, using your library with [framework/ORM/router]?"

### 2d — Confirm initial skill map

Synthesize what you heard into a proposed skill list and present it:

> "Based on what you've told me, here's my proposed skill list:
> [enumerate skills with one-line descriptions]. Does this match how
> you think about your library? What would you add, remove, or rename?"

**── STOP ── Do not proceed to Phase 3 until the maintainer has
reviewed and confirmed (or corrected) the skill list.**

---

## Phase 3 — Deep read (autonomous)

You now have the maintainer's task map. Read docs and source to fill
each skill area with concrete content — failure modes, code patterns,
gotchas.

### Reading order

Read in this order. Each step builds context for the next.

Before starting, list every file in the docs directory (and subdirectories).
Use this list as a checklist — every narrative file must be read. Do not
sample a subset and extrapolate.

1. **Every narrative guide** — the how-to content, not API reference tables.
   Read every guide file, not a representative sample.
2. **Migration guides** — highest-yield source for failure modes; every
   breaking change is exactly what agents trained on older versions produce
3. **API reference** — scan for exports, type signatures, option shapes
4. **Changelog for major versions** — API renames, removed exports,
   behavioral changes
5. **GitHub issues and discussions** — scan for frequently reported
   confusion, common misunderstandings, recurring questions. Also look
   for what users are implicitly arguing for architecturally — not just
   "people are confused about X" but "users keep expecting X to work
   like Y, which reveals a tension between [design force] and [design force]."
   If no web access, check for FAQ.md, TROUBLESHOOTING.md, or docs/faq
   as proxies.
6. **Source code** — verify ambiguities from docs, check defaults, find
   assertions and invariant checks. For monorepos, read the 2–3 core
   packages deeply. For adapter packages, read one representative adapter
   deeply, then scan others for deviations from the pattern.

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

These become high-priority failure modes.

### 3a — Group concepts into domains

Move concept inventory items into groups. Two items belong together when:

- A developer reasons about them together when solving a problem
- Solving one correctly requires understanding how the other works
- They share a lifecycle, configuration scope, or architectural tradeoff
- Getting one wrong tends to produce bugs in the other

Target 4–7 domains. These are conceptual groupings, not the final skills.

Do not create a group for:

- A single hook, function, or class
- A single doc or reference page
- "Miscellaneous", "Advanced", or "Other"
- Configuration knobs that only affect another group's behavior

Name each domain as work being performed, not what the library provides.

### 3b — Map domains × tasks → skills

Merge your conceptual domains with the maintainer's task list from
Phase 2. Each skill should match a specific developer moment while
carrying the conceptual depth of its parent domain(s).

A skill is well-shaped when:

- A developer would ask for it by name ("help me set up sync")
- It covers enough for the agent to complete the task end-to-end
- It doesn't require loading 3 other skills to be useful

Some domains produce multiple skills (a broad domain like "data access"
might yield "live-queries", "mutations", "offline-sync"). Some tasks
span domains (a "go-live" checklist touches security, performance, and
configuration). Both are fine.

Also consider:

- **Lifecycle/journey skills** — if the library's docs include a
  quickstart guide, go-to-production checklist, or migration path,
  suggest these as standalone skills. Don't force them if the docs
  don't have the material.
- **Composition skills** — when peer deps or examples show consistent
  co-usage with another library, output a full skill for the
  integration, not a footnote on a domain.

### 3c — Flag subsystems within skills

Check each skill area for internal diversity. A skill may be
conceptually unified but contain multiple independent subsystems with
distinct config interfaces — for example, 5 sync adapters that all
solve "connectivity" but each with unique setup, options, and failure
modes.

For each skill, ask: "Does this cover 3+ backends, adapters, drivers,
or providers with distinct configuration surfaces?" If yes, list them
as `subsystems`. These tell the skill-tree-generator to produce
per-subsystem reference files.

Also flag dense API surfaces — if a topic has >10 distinct operators,
option shapes, or patterns (e.g. query operators, schema validation
rules), note it as a `reference_candidates` entry.

### 3d — Extract failure modes

For each skill, extract failure modes that pass all three tests:

- **Plausible** — An agent would generate this because it looks correct
  based on the library's design, a similar API, or an older version
- **Silent** — No immediate crash; fails at runtime or under specific conditions
- **Grounded** — Traceable to a specific doc page, source location, or issue

**Where to find them:**

| Source               | What to extract                                                    |
| -------------------- | ------------------------------------------------------------------ |
| Migration guides     | Every breaking change → old pattern is the wrong code              |
| Doc callouts         | Any "note", "warning", "avoid" with surrounding context            |
| Source assertions    | `throw` and `invariant()` messages describe the failure            |
| Default values       | Undocumented or surprising defaults that cause wrong behavior      |
| Type precision       | Source type more restrictive than docs imply                       |
| Environment branches | `typeof window`, SSR flags, `NODE_ENV` — behavior differs silently |

Target 3 failure modes per skill minimum. Complex skills target 5–6.

**Cross-skill failure modes.** Some failure modes belong to multiple
skills. A developer doing SSR work and a developer doing state management
both need to know about "stale state during hydration" — they load
different skills but need the same advice. When a failure mode spans
skills, list all relevant skill slugs in its `skills` field. The
skill-tree-generator will write it into every corresponding SKILL file.

List a cross-skill failure mode once, under its primary skill. Set
the `skills` field to all skill slugs it applies to. Do not duplicate
the entry in the YAML — the skill-tree-generator handles duplication
into multiple SKILL files at generation time.

### 3e — Identify cross-skill tensions

Look for places where design forces between skills conflict. A tension
is not a failure mode — it's a structural pull where optimizing for one
task makes another harder. Examples:

- "Getting-started simplicity conflicts with production operational safety"
- "Type-safety strictness conflicts with rapid prototyping flexibility"
- "SSR correctness requires patterns that hurt client-side performance"

Tensions are where agents fail most because they optimize for one task
without seeing the tradeoff. Each tension should name the skills in
conflict, describe the pull, and state what an agent gets wrong when it
only considers one side.

Target 2–4 tensions. If you find none, the skills may be too isolated —
revisit whether you're missing cross-connections.

### 3f — Identify gaps

For each skill, explicitly list what you could NOT determine from docs
and source alone. These become interview questions in Phase 4.

Common gaps:

- "Docs describe X but don't explain when you'd choose X over Y"
- "Migration guide mentions this changed but doesn't say what the old
  behavior was"
- "Source has an assertion here but no doc explains what triggers it"
- "GitHub issues show confusion about X but docs don't address it"
- "I found two patterns for doing X — unclear which is current/preferred"

### 3g — Discover composition targets

Scan `package.json` for peer dependencies, optional dependencies, and
`peerDependenciesMeta`. Scan example directories and integration tests
for import patterns. For each frequently co-used library, log:

- Library name and which features interact
- Whether it's a required or optional integration
- Any example code showing the integration pattern

These become targeted composition questions in Phase 4e.

### 3h — Produce the draft

Write the full `domain_map.yaml` (format in Output Artifacts below) with
a `status: draft` field. Flag every gap in the `gaps` section.

Present the draft to the maintainer before starting Phase 4:

> "I've read the docs and source for [library] and produced a draft with
> [N] skills and [M] failure modes. I've flagged [K] specific gaps where
> I need your input."

Include the full draft domain_map.yaml in your message so the maintainer
can review it. Also include a checklist of all docs files you read.

**── STOP ── Do not proceed to Phase 4 until the maintainer has
reviewed the draft and responded. Their feedback on the draft informs
the detail interview questions.**

---

## Phase 4 — Detail interview (interactive — requires maintainer)

You have the maintainer's task map and a deep read. The interview now
fills gaps, validates your understanding, and surfaces implicit knowledge.

You must ask the questions below to the maintainer and wait for their
responses. Do not infer answers from documentation or source code —
even for gaps you think you can answer from your reading.

### Rules for Phase 4

1. One topic per message for open-ended questions. You may batch 2–3
   yes/no or short-confirmation questions together.
2. Ask each question as written (you may adapt phrasing to context, but
   keep questions open-ended — never convert to multiple-choice).
3. Each question must reference something specific from your reading.
4. Wait for the maintainer's response after each question before asking
   the next.
5. If the maintainer gives a short answer, probe deeper before moving on.
6. Take notes silently. Do not summarize back unless asked.

### 4a — Draft review (2–3 questions)

Start by confirming or correcting your skill list and failure modes:

> "Here's the skill list I've built from our earlier conversation plus
> the deep read: [list skills with brief descriptions]. Does this still
> match your thinking? Anything to add, remove, or rename?"

Follow up on any corrections. Then:

> "I identified [M] failure modes from the docs and migration guides. Are
> there important ones I missed — especially patterns that look correct
> but fail silently?"

### 4b — Gap-targeted questions (3–8 questions)

For each gap flagged in Phase 3f, ask a specific question. These are not
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

### 4c — AI-agent-specific failure modes (2–4 questions)

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

### 4d — Implicit knowledge extraction (3–5 questions)

These surface knowledge that doesn't appear in any docs:

- "What does a senior developer using your library know that a mid-level
  developer doesn't — something that isn't written down anywhere?"
- "Are there patterns that work fine for prototyping but are dangerous
  in production? What makes them dangerous?"
- "What question do you answer most often in Discord or GitHub issues
  that the docs technically cover but people still miss?"
- "Is there anything you'd change about the API design if you could break
  backwards compatibility? What's the current workaround?"

### 4e — Composition questions (if library interacts with others)

Use what you discovered in Phase 3g. For each integration target
identified from peer dependencies and example code, ask targeted
questions:

- "I see [library] is a peer dependency and [N] examples import it
  alongside yours. What's the most common integration mistake?"
- "When developers use [your library] with [other library], are there
  patterns that only matter when both are present?"
- "I found [specific integration pattern] in the examples. Is this the
  recommended approach, or is there a better way that isn't documented?"

---

## Phase 5 — Finalize artifacts

Merge interview findings into the draft. For each interview answer:

1. If it confirms a skill or failure mode — no action needed
2. If it corrects something — update the map
3. If it adds a new failure mode — add it with source "maintainer interview"
4. If it reveals a new skill — add it
5. If it fills a gap — remove from gaps section

Update `status: draft` to `status: reviewed`.

---

## Output artifacts

If the maintainer uses a custom skills root, replace `skills/` in the paths
below with their chosen directory.

### 1. skills/\_artifacts/domain_map.yaml

```yaml
# domain_map.yaml
# Generated by skill-domain-discovery
# Library: [name]
# Version: [version this map targets]
# Date: [ISO date]
# Status: [draft | reviewed]

library:
  name: '[package-name]'
  version: '[version]'
  repository: '[repo URL]'
  description: '[one line]'
  primary_framework: '[React | Vue | Svelte | framework-agnostic]'

domains:
  - name: '[work-oriented domain name]'
    slug: '[kebab-case]'
    description: '[conceptual grouping — what a developer is reasoning about]'

skills:
  - name: '[task-focused skill name]'
    slug: '[kebab-case]'
    domain: '[parent domain slug]'
    description: '[what a developer is doing — matches a specific task/moment]'
    type: '[core | framework | lifecycle | composition]'
    packages: # required for monorepo; omit for single-package libraries
      - '[primary package name]'
      - '[secondary package name, if skill spans multiple packages]'
    covers:
      - '[API/hook/concept 1]'
      - '[API/hook/concept 2]'
    tasks:
      - '[example task 1]'
      - '[example task 2]'
      - '[example task 3]'
    subsystems: # omit if skill has no independent subsystems
      - name: '[adapter/backend name]'
        package: '[npm package if separate]'
        config_surface: '[brief description of unique config]'
    reference_candidates: # omit if no dense API surfaces
      - topic: '[e.g. query operators, schema validation]'
        reason: '[e.g. >10 distinct operators with signatures]'
    failure_modes:
      - mistake: '[5-10 word phrase]'
        mechanism: '[one sentence]'
        source: '[doc page, source file, issue link, or maintainer interview]'
        priority: '[CRITICAL | HIGH | MEDIUM]'
        status: '[active | fixed-but-legacy-risk | removed]'
        version_context: "[e.g. 'Fixed in v5.2 but agents trained on older code still generate this']"
        skills: ['[this-skill-slug]'] # list all skills this belongs to; omit if single-skill
    compositions:
      - library: '[other library name]'
        skill: '[composition skill name if applicable]'

tensions:
  - name: '[short phrase describing the pull]'
    skills: ['[skill-slug-a]', '[skill-slug-b]']
    description: '[what conflicts — one sentence]'
    implication: '[what an agent gets wrong when it only considers one side]'

gaps:
  - skill: '[skill slug]'
    question: '[what still needs input]'
    context: '[why this matters]'
    status: '[open | resolved]'
```

### 2. skills/\_artifacts/skill_spec.md

A human-readable companion document. Follow this structure:

```markdown
# [Library Name] — Skill Spec

[2–3 sentences: what this library is, what problem it solves. Factual,
not promotional.]

## Domains

| Domain | Description           | Skills                  |
| ------ | --------------------- | ----------------------- |
| [name] | [conceptual grouping] | [skill-1, skill-2, ...] |

## Skill Inventory

| Skill  | Type                                   | Domain   | What it covers | Failure modes |
| ------ | -------------------------------------- | -------- | -------------- | ------------- |
| [name] | [core/framework/lifecycle/composition] | [domain] | [list]         | [count]       |

## Failure Mode Inventory

### [Skill name] ([count] failure modes)

| #   | Mistake  | Priority | Source                 | Cross-skill?             |
| --- | -------- | -------- | ---------------------- | ------------------------ |
| 1   | [phrase] | CRITICAL | [doc/source/interview] | [other skill slugs or —] |

[Repeat table for each skill.]

## Tensions

| Tension        | Skills              | Agent implication       |
| -------------- | ------------------- | ----------------------- |
| [short phrase] | [slug-a] ↔ [slug-b] | [what agents get wrong] |

## Subsystems & Reference Candidates

| Skill  | Subsystems                     | Reference candidates       |
| ------ | ------------------------------ | -------------------------- |
| [slug] | [adapter1, adapter2, ...] or — | [topic needing depth] or — |

## Remaining Gaps

| Skill  | Question                 | Status |
| ------ | ------------------------ | ------ |
| [slug] | [what still needs input] | open   |

[Omit this section if all gaps were resolved in the interview.]

## Recommended Skill File Structure

- **Core skills:** [list which skills are framework-agnostic]
- **Framework skills:** [list per-framework skills needed]
- **Lifecycle skills:** [list journey/lifecycle skills if applicable]
- **Composition skills:** [list integration seams needing composition skills]
- **Reference files:** [list skills needing references/ based on subsystems
  or dense API surfaces]

## Composition Opportunities

| Library | Integration points | Composition skill needed?     |
| ------- | ------------------ | ----------------------------- |
| [name]  | [what interacts]   | [yes/no — if yes, skill name] |
```

---

## Constraints

| Check                                 | Rule                                                                       |
| ------------------------------------- | -------------------------------------------------------------------------- |
| Quick scan before interview           | Never interview without at least reading README and package structure      |
| High-level interview before deep read | The maintainer's task map informs what you read deeply                     |
| **Interview phases are interactive**  | Phases 2 and 4 require sending questions to the maintainer and waiting     |
| **Docs are not a substitute**         | Documentation cannot replace maintainer answers — even comprehensive docs  |
| **Open-ended questions stay open**    | Never convert interview questions to multiple-choice or yes/no             |
| **Minimum question counts enforced**  | Each sub-section's minimum count must be met; zero questions = violation   |
| **STOP gates are mandatory**          | Do not proceed past a STOP gate without maintainer response                |
| Batch only confirmations              | Yes/no questions may batch 2–3; open-ended questions get their own message |
| Questions reference findings          | No generic questions — cite what you found                                 |
| Skills are task-focused               | Each skill matches a developer moment, not a conceptual area               |
| 3+ failure modes per skill            | Complex skills target 5–6                                                  |
| Every failure mode sourced            | Doc page, source file, issue link, or maintainer interview                 |
| Gaps are explicit                     | Unknown areas flagged, not guessed                                         |
| No marketing prose                    | Library description is factual, not promotional                            |
| domain_map.yaml is valid YAML         | Parseable by any YAML parser                                               |
| Draft before detail interview         | Present draft for review before Phase 4                                    |
| **Draft reviewed before Phase 4**     | Maintainer must acknowledge or respond to draft before detail interview    |
| Agent-specific failures probed        | Always ask AI-agent-specific questions in Phase 4c                         |
| Compositions discovered from code     | Scan peer deps and examples before asking composition questions            |
| Cross-skill failure modes tagged      | Failure modes spanning skills list all relevant slugs                      |
| Tensions identified                   | 2–4 cross-skill tensions; if none found, revisit skill boundaries          |
| Subsystems flagged                    | Skills with 3+ adapters/backends list them as subsystems                   |
| Dense surfaces flagged                | Topics with >10 patterns noted as reference_candidates                     |
| Lifecycle skills considered           | Suggest journey skills when docs have the material                         |
| **All docs files read**               | List docs directory contents and read every narrative file — no sampling   |

---

## Cross-model compatibility notes

This skill is designed to produce consistent results across Claude, GPT-4+,
Gemini, and open-source models. To achieve this:

- All instructions use imperative sentences, not suggestions
- Interview phases use explicit STOP gates to prevent models from
  continuing autonomously past interactive checkpoints
- Hard rules at the top override any model tendency to rationalize
  skipping interactive phases when documentation is available
- Open-ended questions are explicitly protected from conversion to
  multiple-choice or confirmation prompts, which models default to
  when they have enough context to pre-populate answers
- Output formats use YAML (universally parsed) and Markdown tables
  (universally rendered)
- Examples use concrete values, not placeholders like "[your value here]"
- Section boundaries use Markdown headers (##) for navigation and --- for
  phase separation
- No model-specific features (no XML tags in output, no tool_use assumptions)

---

## Meta-skill feedback (mandatory — do not skip)

**This step is required.** Agents routinely skip feedback collection
because it appears at the end of the skill. You must complete this step
before the domain discovery process is considered finished.

After finalizing artifacts, ask the maintainer for feedback on the domain
discovery process. Do not silently create the feedback template — present
it to the maintainer and ask them to fill in the Domain Discovery section.

**── STOP ── Ask the maintainer to provide feedback. Wait for their
response before writing the feedback file.**

Create or update a single Markdown feedback draft
for all three meta skills used in scaffolding. Use this exact template and
fill only the **Domain Discovery** section now. Leave the other sections in
place for later steps to complete.

```
# Playbook Meta Skill Feedback

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

Do not submit feedback yet. Tell the maintainer to carry this draft forward
to the next meta skill step.
