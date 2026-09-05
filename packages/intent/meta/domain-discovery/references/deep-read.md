## Phase 3 — Deep read (autonomous)

You now have the maintainer's task map. Read docs and source to fill each skill area with concrete content — failure modes, code patterns, gotchas.

### Reading order

Read in this order. Each step builds context for the next.

Before starting, list every file in the local docs directory (and subdirectories). Use this list as a checklist — read every local narrative file, regardless of the collection's size. Do not extrapolate from a sample.

1. **Narrative guides** — read local guides exhaustively. Prioritize getting-started, migration, and guides covering the skill areas from Phase 2; priority determines reading order, not which local files to omit. For online-only docs or exceptionally large external collections, sampling is allowed only when full reading would exceed an explicit task budget or access limit. Record that limit and inventory the available pages from the documentation index. Read the getting-started and migration guides plus guides for each Phase 2 skill area. Record the selected URLs, unread areas, and selection rationale in the coverage checklist; flag inaccessible or uncovered areas as gaps rather than claiming full coverage. This exception does not apply to local documentation.
2. **Migration guides** — highest-yield source for failure modes; every breaking change is exactly what agents trained on older versions produce
3. **API reference** — scan for exports, type signatures, option shapes
4. **Changelog for major versions** — API renames, removed exports, behavioral changes
5. **GitHub issues and discussions** — this is one of the highest-yield sources for failure modes and skill content. Docs describe intended behavior; issues reveal actual behavior and real developer confusion.

   **How to search.** Use `gh search issues` and `gh search prs` (or the GitHub web search UI) against the library's repo. Run multiple passes:
   - **High-engagement issues:** sort by reactions or comments to find the problems that affect the most developers. These are skill-worthy even if already fixed — agents trained on older data still hit them.
   - **Label-based scans:** look for labels like `bug`, `question`, `documentation`, `breaking-change`, `good first issue`, `FAQ`, `help wanted`. Each label category yields different signal:
     - `bug` + `closed` → failure modes with known fixes (wrong/correct pairs)
     - `question` → developer confusion that skills should preempt
     - `breaking-change` → migration-boundary mistakes
   - **Keyword searches:** search for the skill's primary APIs, hooks, and config options by name. E.g. `useQuery stale` or `hydration SSR`.
   - **Recent vs. historical:** scan the last 6–12 months of open issues for current pain points. Then scan older closed issues for patterns that are now fixed but still appear in agent training data.

   **GitHub Discussions** are equally important when the repo uses them. Discussions surface "how do I..." patterns and architectural questions that issues don't capture. Search the Discussions tab (or use `gh api` to query discussions) for:
   - Unanswered or long-thread questions (signal: docs are insufficient)
   - Threads marked as "Answered" with a non-obvious solution (skill content)
   - Recurring themes across multiple threads (systemic confusion)

   **What to extract from issues/discussions:**
   - Frequently reported confusion patterns → candidate failure modes
   - Workarounds that developers use before a fix ships → "wrong pattern" examples that agents will reproduce
   - Recurring "how do I X with Y" threads → composition skill candidates
   - Misunderstandings about defaults or config → skill content gaps
   - Feature requests with many upvotes that change API design → signals of where the API surface is unintuitive
   - What users are implicitly arguing for architecturally — not just "people are confused about X" but "users keep expecting X to work like Y, which reveals a tension between [design force] and [design force]"

   **What NOT to extract:** one-off bugs already fixed, feature requests unrelated to current API surface, issues about build tooling or CI that don't affect library usage patterns.

   **Fallback.** If no web access is available, check for FAQ.md, TROUBLESHOOTING.md, docs/faq, or KNOWN_ISSUES.md as proxies. Also scan the repo's `.github/ISSUE_TEMPLATE/` for hints about common issue categories.

6. **Source code** — verify ambiguities from docs, check defaults, find assertions and invariant checks. For monorepos, read the 2–3 core packages deeply. For adapter packages, read one representative adapter deeply, then scan others for deviations from the pattern.

### What to log

Produce a flat concept inventory. One item per line. No grouping yet.

Log every:

- Named concept, abstraction, or lifecycle stage
- Public export: function, hook, class, type, constant
- Configuration key, its type, and its default value
- Constraint or invariant (especially any enforced by `throw` or assertion)
- Doc callout: any "note", "warning", "caution", "important", "avoid", "do not"
- Dual API: any place the library has two ways to do the same thing (old/new, verbose/shorthand, lower-level/higher-level)
- Environment branch: any place behavior depends on SSR/CSR, dev/prod, framework, bundler, or config flag
- Type gap: any type documented as accepting X but source shows X | Y or rejects a subtype of X
- Source assertion: any `if (!x) throw`, `invariant()`, or `assert()` with the error message text
- Issue/discussion pattern: any recurring confusion, workaround, or misunderstanding surfaced from GitHub issues or discussions — note the issue/discussion URL, the core misunderstanding, and whether it's resolved or still active

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

Let library complexity drive the domain count — a focused library may need only 2–3 domains, while a large framework may need 7+. Validate by asking: "Would a developer working on a single feature need to load skills from multiple domains? If so, merge those domains." These are conceptual groupings, not the final skills.

Do not create a group for:

- A single hook, function, or class
- A single doc or reference page
- "Miscellaneous", "Advanced", or "Other"
- Configuration knobs that only affect another group's behavior

Name each domain as work being performed, not what the library provides.

**Validation step:** After grouping, check each domain by asking: "Would a developer working on a single feature need to load skills from multiple domains?" If yes, merge those domains. Group by developer tasks (what they're trying to accomplish), not by architecture (how the library is organized internally). For example, prefer "writing data" over "producer lifecycle" — the former matches a developer's intent, the latter matches the codebase structure.

### 3b — Map domains × tasks → skills

Merge your conceptual domains with the maintainer's task list from Phase 2. Each skill should match a specific developer moment while carrying the conceptual depth of its parent domain(s).

A skill is well-shaped when:

- A developer would ask for it by name ("help me set up sync")
- It covers enough for the agent to complete the task end-to-end
- Its genuine prerequisites are accessible through precise reading pointers

Some domains produce multiple skills (a broad domain like "data access" might yield "live-queries", "mutations", "offline-sync"). Some tasks span domains (a "go-live" checklist touches security, performance, and configuration). Both are fine.

Also consider:

- **Lifecycle/journey skills** — if the library's docs include a quickstart guide, go-to-production checklist, or migration path, suggest these as standalone skills. Don't force them if the docs don't have the material.
- **Composition skills** — when peer deps or examples show consistent co-usage with another library, output a full skill for the integration, not a footnote on a domain.

### 3c — Flag subsystems within skills

Check each skill area for internal diversity. A skill may be conceptually unified but contain multiple independent subsystems with distinct config interfaces — for example, 5 sync adapters that all solve "connectivity" but each with unique setup, options, and failure modes.

For each skill, ask: "Does this cover 3+ backends, adapters, drivers, or providers with distinct configuration surfaces?" If yes, list them as `subsystems`. These tell the tree-generator to produce per-subsystem reference files.

Also flag dense API surfaces — if a topic has >10 distinct operators, option shapes, or patterns (e.g. query operators, schema validation rules), note it as a `reference_candidates` entry.

### 3d — Extract failure modes

For each skill, extract failure modes that pass all three tests:

- **Plausible** — An agent would generate this because it looks correct based on the library's design, a similar API, or an older version
- **Consequential** — Wrong results, runtime errors, or failures under specific conditions
- **Grounded** — Traceable to a specific doc page, source location, or issue

**Where to find them:**

| Source               | What to extract                                                      |
| -------------------- | -------------------------------------------------------------------- |
| Migration guides     | Every breaking change → old pattern is the wrong code                |
| Doc callouts         | Any "note", "warning", "avoid" with surrounding context              |
| Source assertions    | `throw` and `invariant()` messages describe the failure              |
| Default values       | Undocumented or surprising defaults that cause wrong behavior        |
| Type precision       | Source type more restrictive than docs imply                         |
| Environment branches | `typeof window`, SSR flags, `NODE_ENV` — behavior differs silently   |
| GitHub issues        | Recurring bug reports with workarounds → wrong/correct code pairs    |
| GitHub discussions   | "How do I…" threads with non-obvious answers → missing skill content |

Include the source-backed failure modes necessary for the task. Preserve error handling; do not invent extra entries to meet a count.

**Code patterns.** Every failure mode should include `wrong_pattern` and `correct_pattern` fields with short code snippets (3–10 lines each). The wrong pattern is what an agent would generate; the correct pattern is the fix. These feed directly into SKILL.md Common Mistakes sections as wrong/correct code pairs. If the failure mode is purely conceptual (e.g. an architectural choice) rather than a code pattern, omit both fields and explain in `mechanism` instead.

**Cross-skill failure modes.** Some failure modes belong to multiple skills. A developer doing SSR work and a developer doing state management both need to know about "stale state during hydration" — they load different skills but need the same advice. When a failure mode spans skills, list all relevant skill slugs in its `skills` field. The tree-generator will make it accessible from every corresponding SKILL file.

List a cross-skill failure mode once, under its primary skill. Set the `skills` field to all skill slugs it applies to. Do not duplicate the entry in the YAML. Tree-generator makes the authoritative guidance reachable from every affected skill through precise reading pointers.

### 3e — Identify cross-skill tensions

Look for places where design forces between skills conflict. A tension is not a failure mode — it's a structural pull where optimizing for one task makes another harder. Examples:

- "Getting-started simplicity conflicts with production operational safety"
- "Type-safety strictness conflicts with rapid prototyping flexibility"
- "SSR correctness requires patterns that hurt client-side performance"

Tensions are where agents fail most because they optimize for one task without seeing the tradeoff. Each tension should name the skills in conflict, describe the pull, and state what an agent gets wrong when it only considers one side.

Target 2–4 tensions. If you find none, the skills may be too isolated — revisit whether you're missing cross-connections.

### 3f — Map cross-references

Beyond tensions (conflicts) and shared failure modes, identify skills that illuminate each other without conflicting. A cross-reference means: "an agent loading skill A would produce better code if it knew about skill B." These become "See also" pointers in the generated SKILL.md files.

For each pair, note:

- Which skill references which (can be bidirectional)
- Why awareness of the other skill improves output

Examples:

- A quickstart skill references the security checklist ("after setup, audit")
- A state management skill references an SSR skill ("state hydration requires understanding SSR lifecycle")
- A data writing skill references a data reading skill ("writes affect how queries invalidate")

Output these in the `cross_references` section of domain_map.yaml.

### 3g — Identify gaps

For each skill, explicitly list what you could NOT determine from docs and source alone. These become interview questions in Phase 4.

Common gaps:

- "Docs describe X but don't explain when you'd choose X over Y"
- "Migration guide mentions this changed but doesn't say what the old behavior was"
- "Source has an assertion here but no doc explains what triggers it"
- "GitHub issues show confusion about X but docs don't address it"
- "I found two patterns for doing X — unclear which is current/preferred"

### 3h — Discover composition targets

Scan `package.json` for peer dependencies, optional dependencies, and `peerDependenciesMeta`. Scan example directories and integration tests for import patterns. For each frequently co-used library, log:

- Library name and which features interact
- Whether it's a required or optional integration
- Any example code showing the integration pattern

These become targeted composition questions in Phase 4e.

### 3i — Produce the draft

Write the full `domain_map.yaml` (format in [artifact formats](artifacts.md)) with a `status: draft` field. Flag every gap in the `gaps` section.

Present the draft to the maintainer before starting Phase 4:

> "I've read the docs and source for [library] and produced a draft with [N] skills and [M] failure modes. I've flagged [K] specific gaps where I need your input."

Include the full draft domain_map.yaml in your message so the maintainer can review it. Also include the coverage checklist: all local docs files read and, when external docs were sampled, the limit, selected URLs, unread areas, and selection rationale.

**── STOP ── Do not proceed to Phase 4 until the maintainer has reviewed the draft and responded. Their response to the draft informs the detail interview questions.**

---
