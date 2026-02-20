---
title: TanStack Playbook
version: '1.4'
status: draft
owner: tanstack-core
contributors: []
created: 2026-02-19
last_updated: 2026-02-19
---

# TanStack Playbook

## Summary

Coding agents now perform half of development work, but without TanStack-specific guidance they rely on outdated or incomplete knowledge — conflating packages, missing compositions, or applying wrong framework patterns. This RFC defines a playbook architecture: a single `@tanstack/playbook` repo that owns all skills, distilled from the source documentation of `@tanstack/query`, `@tanstack/router`, `@tanstack/db`, `@tanstack/form`, and `@tanstack/table`. Skills are written for agent consumption (not human reading), generated initially via a documented prompt, and kept current via a CI system using GitHub Actions as a trigger layer and Warp Oz as the autonomous agent that evaluates staleness, rewrites skills, and opens PRs. Each library has its own router skill that routes agents within that library's skills — there is no global cross-library router in v1. A CLI installs skills to `.agents/skills/` by default with other agent directories as options, and emits an AGENTS.md snippet on install. Phase 1 covers React adapter only.

---

## Background

### A Playbook is a Collection of Skills

A **playbook** is the collection of skills, patterns, and tools someone uses in a vibe-coding context — analogous to "stack" but for the less deliberate, more aesthetic-driven way people assemble their setup now.

`@tanstack/playbook` is a single npm package and repo that contains all TanStack skills. It draws from five source packages but owns all the content itself:

- Skills distilled from `@tanstack/query` — async state management, fetching, caching, mutations
- Skills distilled from `@tanstack/router` — type-safe routing, search params, loaders
- Skills distilled from `@tanstack/db` — reactive client-side database, live queries, optimistic mutations
- Skills distilled from `@tanstack/form` — form state, async validation, submission
- Skills distilled from `@tanstack/table` — headless table logic, sorting, filtering, pagination

### Skills Are Written for Agents, Not People

Skills are not documentation. They are agent instructions — terse, procedural, example-driven. The target reader is a coding agent (Claude Code, Cursor, Copilot, Warp Oz) that already knows TypeScript and React. A skill should only contain what the agent cannot already know: TanStack-specific patterns, package-specific API shapes, common mistakes, and composition recipes.

The Skills specification (agentskills.io) defines the standard format:

```
skill-name/
├── SKILL.md          # Entry point (<500 lines)
├── scripts/          # Executable code
├── references/       # On-demand detail
└── assets/           # Templates, schemas
```

Skills use progressive disclosure: metadata loads at session start, full instructions load when triggered, references load only when explicitly needed. This optimizes context window usage.

### TanStack's Product Suite

TanStack provides a composable set of headless, framework-agnostic primitives:

- **TanStack Query** (`@tanstack/react-query`): Async state management — fetching, caching, background refetching
- **TanStack Router** (`@tanstack/react-router`): Fully type-safe routing, search params, navigation
- **TanStack DB** (`@tanstack/db`): Reactive client-side database with live queries and optimistic mutations
- **TanStack Form** (`@tanstack/react-form`): Headless form state, async validation, submission
- **TanStack Table** (`@tanstack/react-table`): Headless table logic — sorting, filtering, pagination, grouping

Phase 1 covers React adapters only. Other framework adapters (Vue, Solid, Svelte, Angular) follow after React skills are validated.

---

## Problem

**Core hypothesis:** Developers will adopt and benefit from TanStack-specific agent skills.

Without TanStack skills, agents rely on general knowledge that is frequently incomplete. Three specific problems:

### 1. Fragmented Guidance Across Packages

A developer building a typical app touches Router, Query, Form, and Table simultaneously. No unified guidance exists for how these compose. Agents stitch together five separate documentation sources and frequently miss cross-package patterns entirely.

### 2. No Canonical Composition Recipes

Common compositions lack clear guidance:

- **Router + Query**: Using Router loaders to prefetch Query cache entries, avoiding waterfall fetching
- **DB + Query**: When to use TanStack DB live queries vs Query async fetching
- **Form + Query**: Submitting mutations, handling async validation against server state
- **Form + Table**: Inline editing with row-level form state

### 3. Framework Adapter Confusion

Each package ships multiple framework adapters. Agents frequently import from the wrong adapter or apply React patterns in non-React projects. Phase 1 eliminates this for React by explicitly scoping all skills to the React adapter.

---

## Goals & Non-Goals

### Goals

1. **Publish `@tanstack/playbook`** as the single repo and npm package that owns all TanStack agent skills
2. **Distill skills from `@tanstack/query`** React docs into the playbook repo
3. **Distill skills from `@tanstack/router`** React docs into the playbook repo
4. **Distill skills from `@tanstack/db`** docs into the playbook repo
5. **Distill skills from `@tanstack/form`** React docs into the playbook repo
6. **Distill skills from `@tanstack/table`** React docs into the playbook repo
7. **Implement a per-library router skill** in each library group (e.g. `tanstack-query/router`, `tanstack-router/router`) that routes agents within that library's skills — no global cross-library router in v1
8. **Implement CI automation** — GitHub Actions as trigger layer, Warp Oz as autonomous agent that evaluates staleness, rewrites skills, and opens PRs; including cross-skill reference staleness checks
9. **Implement a skill generation prompt** for bootstrapping skills from source docs for the first time
10. **CLI with selective install** — `.agents/skills/` as primary target, other agent directories as options; emits AGENTS.md snippet on install
11. **React-first** — Phase 1 covers React adapter only; other frameworks after validation

### Non-Goals

- **Skills co-located in package repos** — the playbook repo owns all skill content
- **Other framework adapters in Phase 1** — Vue, Solid, Svelte, Angular after React is validated
- **Evals and feedback loop** — separate effort when ready
- **Non-TypeScript languages** — TypeScript/JavaScript only
- **Instrumentation/telemetry** — rely on npm stats and qualitative feedback
- **Skill versioning strategy** — skills version with the playbook package
- **Backwards compatibility for skill structure changes** — not worth solving at this stage

---

## Proposal

### Repository Structure

All skills live in `@tanstack/playbook`. The repo also contains the CLI, the Oz automation config, the internal staleness-check skill, and the skill generation prompt.

```
@tanstack/playbook/
├── skills/
│   ├── tanstack-query/                 # Skills distilled from @tanstack/query
│   │   ├── router/
│   │   │   └── SKILL.md               # Query router: routes within Query skills only
│   │   ├── core/
│   │   │   ├── SKILL.md
│   │   │   └── references/
│   │   ├── caching/
│   │   │   ├── SKILL.md
│   │   │   └── references/
│   │   ├── infinite/
│   │   │   └── SKILL.md
│   │   └── suspense/
│   │       └── SKILL.md
│   │
│   ├── tanstack-router/                # Skills distilled from @tanstack/router
│   │   ├── router/
│   │   │   └── SKILL.md               # Router router: routes within Router skills only
│   │   ├── core/
│   │   │   ├── SKILL.md
│   │   │   └── references/
│   │   ├── search-params/
│   │   │   └── SKILL.md
│   │   ├── loaders/
│   │   │   └── SKILL.md
│   │   └── with-query/
│   │       └── SKILL.md
│   │
│   ├── tanstack-db/                    # Skills distilled from @tanstack/db
│   │   ├── router/
│   │   │   └── SKILL.md               # DB router: routes within DB skills only
│   │   ├── core/
│   │   │   └── SKILL.md
│   │   ├── optimistic/
│   │   │   └── SKILL.md
│   │   └── electric/
│   │       └── SKILL.md
│   │
│   ├── tanstack-form/                  # Skills distilled from @tanstack/form
│   │   ├── router/
│   │   │   └── SKILL.md               # Form router: routes within Form skills only
│   │   ├── core/
│   │   │   ├── SKILL.md
│   │   │   └── references/
│   │   ├── async/
│   │   │   └── SKILL.md
│   │   └── submission/
│   │       └── SKILL.md
│   │
│   ├── tanstack-table/                 # Skills distilled from @tanstack/table
│   │   ├── router/
│   │   │   └── SKILL.md               # Table router: routes within Table skills only
│   │   ├── core/
│   │   │   ├── SKILL.md
│   │   │   └── references/
│   │   ├── features/
│   │   │   └── SKILL.md
│   │   └── virtual/
│   │       └── SKILL.md
│   │
│   └── internal/                       # Not installed to users
│       └── skill-staleness-check/
│           └── SKILL.md
│
├── prompts/
│   └── generate-skill.md              # Prompt for bootstrapping skills from source docs
│
├── .warp/
│   └── automations/
│       └── skill-check.yml            # Oz automation config
│
├── src/                               # CLI source
└── package.json
```

---

### Router Skill Design

Each library group has its own router skill — `tanstack-query/router`, `tanstack-router/router`, `tanstack-db/router`, `tanstack-form/router`, `tanstack-table/router`. There is no global cross-library router in v1.

A library router's job is narrow: when an agent is working with that library, the router reads what the agent is trying to do and points it to the correct skill within that library. It does not try to answer questions itself — it dispatches.

Each router is installed automatically when that library's skills are installed via `--package`. It is always the first skill the agent should load when working with that library.

**Example — `tanstack-query/router`:**

```markdown
---
name: tanstack-query/router
description: Entry point for all TanStack Query work. Load this first, then
  follow the routing table to the correct Query skill. React adapter only.
triggers:
  - react-query
  - useQuery
  - useMutation
  - QueryClient
  - tanstack query
---

# TanStack Query — Router

## Routing Table

| If you are working on...                              | Load this skill             |
| ----------------------------------------------------- | --------------------------- |
| Initial setup, useQuery, useMutation, QueryClient     | `tanstack-query/core`       |
| Cache config, staleTime, gcTime, invalidation         | `tanstack-query/caching`    |
| Paginated or infinite scroll data                     | `tanstack-query/infinite`   |
| Suspense boundaries with data fetching                | `tanstack-query/suspense`   |

## Notes
- All skills cover the **React adapter** only (`@tanstack/react-query`)
- For Vue, Solid, or Svelte, refer to tanstack.com/docs directly
```

**Example — `tanstack-router/router`:**

```markdown
---
name: tanstack-router/router
description: Entry point for all TanStack Router work. Load this first, then
  follow the routing table to the correct Router skill. React adapter only.
triggers:
  - react-router
  - createFileRoute
  - createRootRoute
  - useNavigate
  - tanstack router
---

# TanStack Router — Router

## Routing Table

| If you are working on...                              | Load this skill                 |
| ----------------------------------------------------- | ------------------------------- |
| Route definitions, navigation, type-safe params       | `tanstack-router/core`          |
| Type-safe URL search params, filters in the URL       | `tanstack-router/search-params` |
| Prefetching and loading data before a route renders   | `tanstack-router/loaders`       |
| Using TanStack Query inside Router loaders            | `tanstack-router/with-query`    |

## Notes
- All skills cover the **React adapter** only (`@tanstack/react-router`)
```

The same pattern applies to `tanstack-db/router`, `tanstack-form/router`, and `tanstack-table/router` — each scoped entirely to their own library's skills.

---

### Skill Design Principles

Skills in this repo are written for agents, not humans. Every skill must follow these principles:

#### 1. Agent-first writing

The agent already knows TypeScript, React, and general web development. Do not explain concepts it already has. Only write what it cannot know without the skill: the specific API shape, the gotchas, the correct pattern for this package.

```markdown
# Bad — explains what the agent already knows
React Query is a library for managing server state in React applications.
It handles caching, background refetching, and synchronization...

# Good — gives the agent what it needs
## Setup
\`\`\`typescript
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
const queryClient = new QueryClient()
// Wrap app root with QueryClientProvider
\`\`\`
```

#### 2. Minimal working code examples are required

Every skill must include at least one complete, copy-pasteable code example. Examples must be minimal — no unnecessary boilerplate, no placeholder comments that aren't needed. If the pattern requires context to work, include exactly that context and nothing more.

```typescript
// CORRECT: minimal, complete, copy-pasteable
const { data, isPending, isError } = useQuery({
  queryKey: ['todos', userId],
  queryFn: () => fetchTodos(userId),
})

// WRONG: incomplete — agent can't use this without guessing
const { data } = useQuery({
  queryKey: [...],
  queryFn: ...,
})
```

#### 3. Anti-patterns are as important as correct patterns

Every skill must include a "Common Mistakes" section. The most valuable content in a skill is often what NOT to do — these are the cases where agents generate plausible-looking but broken code.

```markdown
## Common Mistakes

❌ **Don't** use stale query keys that omit dependencies:
\`\`\`typescript
// WRONG — todos won't refetch when userId changes
queryKey: ['todos']
\`\`\`

✅ **Do** include all dependencies in the key:
\`\`\`typescript
// CORRECT
queryKey: ['todos', userId]
\`\`\`
```

#### 4. Skill frontmatter must declare source refs and skill refs

Every skill declares two metadata fields:

- `metadata.sources` — source files in the package repos this skill is derived from; used by the Oz staleness check
- `metadata.skills` — other skills in this playbook this skill references; used to check cross-skill staleness

```yaml
---
name: tanstack-router/with-query
description: ...
metadata:
  sources:
    - 'tanstack/router:packages/react-router/src/route.ts'
    - 'tanstack/router:docs/framework/react/guide/data-loading.md'
  skills:
    - tanstack-query/core
    - tanstack-router/loaders
---
```

If a referenced skill (`tanstack-query/core`, `tanstack-router/loaders`) is updated, `tanstack-router/with-query` is also flagged for a staleness check.

#### 5. Keep SKILL.md under 500 lines

Move detailed API option tables, exhaustive type signatures, and edge case reference material to `references/`. The SKILL.md body should be the fast path — setup, the primary pattern, common mistakes, and pointers to references.

#### 6. Anti-patterns for skill authors

| Anti-Pattern | Problem | Fix |
|---|---|---|
| **The Encyclopedia** | Reads like a wiki, wastes context | Split into focused skills + references |
| **The Everything Bagel** | Triggers on everything | Tighten description and triggers |
| **Missing examples** | Agent has to guess the shape | Every skill needs working code |
| **Human-facing prose** | Wastes tokens on explanation | Replace with examples and steps |
| **No anti-patterns section** | Agent generates plausible-but-wrong code | Always include Common Mistakes |

---

### Skill Frontmatter Schema

```yaml
---
name: tanstack-query/core                 # library-group/skill-name
description: >                            # What it does + when to load it. Written
  TanStack Query setup, useQuery,         # for the agent, not a human reader.
  useMutation, QueryClient. Load when
  fetching server data or managing
  loading/error/success states.
triggers:                                 # Keywords that should activate this skill
  - useQuery
  - useMutation
  - QueryClient
  - react-query
metadata:
  sources:                                # Source files this skill is derived from
    - 'tanstack/query:packages/query-core/src/query.ts'
    - 'tanstack/query:docs/framework/react/guides/queries.md'
  skills:                                 # Other playbook skills this skill references
    - tanstack-query/caching              # If these are updated, re-check this skill
---
```

`metadata.sources` paths use the format `repo-name:relative-path`. Glob patterns are supported.

---

### Cross-Skill Staleness

When a skill is updated by the Oz automation, the system also checks whether any other skills list the updated skill in their `metadata.skills`. If they do, those skills are queued for a staleness evaluation as well.

**Example:**

1. `tanstack/query` merges a change to `docs/framework/react/guides/queries.md`
2. Oz identifies `tanstack-query/core` as affected via `metadata.sources`
3. Oz updates `tanstack-query/core` and opens a PR
4. Oz then scans all other skills for `skills: [tanstack-query/core, ...]`
5. Finds `tanstack-router/with-query` references `tanstack-query/core`
6. Evaluates those skills for staleness against the `tanstack-query/core` update
7. Opens additional PRs if they need updating; exits silently if not

This cascade is bounded to one level — skills that reference `router-query` are not automatically re-checked.

---

### Skill Generation Prompt

Skills are not written by hand initially. The following prompt is used to bootstrap each skill from source documentation for the first time. After that, the Oz automation owns keeping them current.

The prompt lives at `prompts/generate-skill.md` in the playbook repo.

---

```markdown
# Skill Generation Prompt

You are generating a SKILL.md file for the `@tanstack/playbook` agent skills repo.
Skills in this repo are written for coding agents (Claude Code, Cursor, Warp Oz),
not for human readers. Your output will be loaded into an agent's context window
and used to guide code generation.

## Your task

Generate a complete SKILL.md for the skill named: **{SKILL_NAME}**
(Use the format `library-group/skill-name`, e.g. `tanstack-query/core`, `tanstack-router/loaders`)

The skill covers: **{SKILL_DESCRIPTION}**

Source documentation to distill from:
{SOURCE_DOCS}

## Output requirements

Your output must be a valid SKILL.md file with:

### 1. Frontmatter

\`\`\`yaml
---
name: {SKILL_NAME}
description: >
  One to three sentences. What this skill covers and exactly when an agent
  should load it. Written for the agent — include the keywords an agent would
  encounter when it needs this skill.
triggers:
  - list
  - of
  - keywords
metadata:
  sources:
    - 'repo:path/to/source/file'
  skills:
    - other-skill-name   # only if this skill explicitly references another
---
\`\`\`

### 2. A minimal setup example

A complete, copy-pasteable code block showing the minimum viable usage.
No placeholder comments. No unnecessary boilerplate. React adapter only.
Import from the correct `@tanstack/react-*` package.

### 3. The primary pattern(s)

The one to three most important things an agent needs to know to use this
correctly. Each pattern must include a working code example.
Do not explain what the agent already knows (TypeScript, React hooks, etc).
Only write what is specific to this TanStack package and skill.

### 4. Common Mistakes

A "Common Mistakes" section with at least three entries. Each entry must show:
- ❌ The wrong pattern with a code example
- ✅ The correct pattern with a code example
- A one-line explanation of why the wrong pattern fails

Focus on mistakes that produce plausible-looking but broken or subtly incorrect
code — these are the highest-value entries.

### 5. Resources (if needed)

If there are detailed API options, exhaustive type signatures, or edge cases
that are important but too long for the main skill, list them as references:

\`\`\`markdown
## Resources
- [Full option reference](references/api.md)
- [Advanced patterns](references/advanced.md)
\`\`\`

Do NOT include this section if the skill content is already complete without it.

## Constraints

- Total SKILL.md must be under 500 lines
- React adapter only — no Vue, Solid, Svelte, or Angular examples
- All imports must use the real package name (e.g. `@tanstack/react-query`)
- No marketing copy, no motivational prose, no "why TanStack is great"
- No explanations of TypeScript or React concepts the agent already knows
- Every code example must be complete enough to copy-paste without modification
- The description and triggers must be written so the agent loads this skill
  at the right time — not too broad (triggers on everything) and not too narrow
  (never triggers)
```

---

### CI Automation

The CI system uses GitHub Actions as a lightweight trigger layer and Warp Oz as the agent execution layer. Package repos do nothing beyond firing a webhook on merge to main. Oz handles all the intelligence: evaluating staleness, rewriting skill content where needed, checking cross-skill references, and opening (or not opening) PRs.

#### Flow Overview

```
Package repo (e.g. tanstack/query)
  └── merge to main
        └── GitHub Action fires webhook → Warp Oz

Warp Oz
  └── Receives webhook (package name, commit SHA, changed files)
        └── Oz agent (driven by skill-staleness-check skill):
              1. Match changed files against metadata.sources across all skills
              2. For each matched skill:
                 a. Fetch current SKILL.md + file diff
                 b. Evaluate: does the diff affect documented behavior?
                 c. If YES → rewrite skill, open PR
                 d. If NO → skip silently
              3. For each skill that was updated in step 2:
                 a. Find all skills that list it in metadata.skills
                 b. Evaluate those skills for cross-skill staleness
                 c. If stale → rewrite, open PR
                 d. If not → skip silently
```

Oz acts autonomously end-to-end. PRs contain already-updated skill content, not suggestions. If nothing needs updating, no PR is opened and no notification is sent.

#### Package Repo Side (minimal)

Each package repo contains one GitHub Action that fires on merge to main:

```yaml
# .github/workflows/notify-playbook.yml
name: Notify Playbook

on:
  push:
    branches: [main]

jobs:
  dispatch:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 2

      - name: Get changed files
        id: diff
        run: |
          echo "files=$(git diff --name-only HEAD~1 HEAD | jq -R -s -c 'split("\n")[:-1]')" >> $GITHUB_OUTPUT

      - name: Trigger Oz skill check
        run: |
          curl -X POST "${{ secrets.OZ_WEBHOOK_URL }}" \
            -H "Authorization: Bearer ${{ secrets.OZ_WEBHOOK_TOKEN }}" \
            -H "Content-Type: application/json" \
            -d '{
              "package": "@tanstack/query",
              "sha": "${{ github.sha }}",
              "changed_files": ${{ steps.diff.outputs.files }}
            }'
```

Two secrets per package repo: `OZ_WEBHOOK_URL` and `OZ_WEBHOOK_TOKEN`. No cross-repo GitHub tokens needed — Oz handles repo access independently.

#### Oz Agent Side

The Oz automation is configured in the playbook repo and driven by the internal `skill-staleness-check` skill.

```yaml
# .warp/automations/skill-check.yml
name: Skill Staleness Check
trigger: webhook
skill: skills/internal/skill-staleness-check/SKILL.md
environments:
  - repo: tanstack/playbook
  - repo: tanstack/query
  - repo: tanstack/router
  - repo: tanstack/db
  - repo: tanstack/form
  - repo: tanstack/table
```

**`skill-staleness-check` SKILL.md:**

```markdown
---
name: skill-staleness-check
description: Internal Oz automation. Evaluates playbook skills for staleness
  when source files change, rewrites stale skills, checks cross-skill
  references, and opens PRs. Silent when nothing needs updating.
---

## Inputs
Webhook payload: package name, commit SHA, list of changed files.

## Steps

1. Read all SKILL.md files in skills/ — extract metadata.sources and
   metadata.skills per skill
2. Match changed_files against metadata.sources (glob-aware, repo-prefixed paths)
3. For each matched skill:
   a. Fetch current SKILL.md content
   b. Fetch the file diff from the triggering commit in the source repo
   c. Evaluate: does the diff change any behavior, API, pattern, or example
      that this skill documents?
   d. If YES: rewrite the skill to accurately reflect the change. Preserve
      all sections (setup, patterns, common mistakes, resources). Keep under
      500 lines. React adapter only. Then go to step 4.
   e. If NO: skip. Do not open a PR.
4. For each skill updated in step 3:
   a. Scan all other skills for metadata.skills entries that include the
      updated skill name
   b. For each skill that references it: evaluate whether the update to the
      referenced skill makes this skill stale or inconsistent
   c. If YES: rewrite and open a separate PR
   d. If NO: skip
5. For each skill that was rewritten:
   a. Create branch: skill-update/<skill-name>-<short-sha>
   b. Commit updated SKILL.md
   c. Open PR with structured body (see PR format below)

## PR format

Title: skill: update <skill-name> (<package>@<short-sha>)

Body:
  ### Triggered by
  Changes to: <list of source files>

  ### What changed in the source
  <summary of the diff>

  ### What changed in the skill
  <summary of skill edits>

  ### Cross-skill impact
  <list any downstream skills checked; note if PRs were opened for them>

  ### Review checklist
  - [ ] Skill content is accurate
  - [ ] Code examples are complete and copy-pasteable
  - [ ] No other skills need corresponding updates
  - [ ] Under 500 lines

## No-op behavior
If no changed files match any skill's metadata.sources, or if the diff does
not affect documented behavior, exit silently. No PR, no notification.
```

---

### Distribution Strategy: Thin Skills + CLI

#### Installation

```bash
# Install all TanStack skills
npx @tanstack/playbook install

# Install skills for specific packages only
npx @tanstack/playbook install --package query
npx @tanstack/playbook install --package query --package router

# Install globally (user-level agent directories)
npx @tanstack/playbook install --global
```

Valid `--package` values: `query`, `router`, `db`, `form`, `table`

#### Install Target: `.agents/skills/` First

The primary install target is `.agents/skills/` — the emerging standard agent skills directory. When installing, the CLI prompts if other agent directories are also detected:

```
$ npx @tanstack/playbook install --package query

✔ Detected .agents/ directory
  Installing to .agents/skills/

  Also detected:
  → .claude/  (Claude Code)
  → .cursor/  (Cursor)

  Install to these as well? (Y/n)
```

**Supported targets:**

| Directory | Agent |
|---|---|
| `.agents/skills/` | Primary — standard Skills spec |
| `.claude/skills/` | Claude Code |
| `.cursor/skills/` | Cursor |
| `.codex/skills/` | OpenAI Codex |
| `.windsurf/skills/` | Windsurf |
| `.github/skills/` | GitHub Copilot |

#### AGENTS.md Snippet

After installing, the CLI emits a snippet the developer should add to their `AGENTS.md` file. This tells agents where the playbook skills are and how to use them.

```
$ npx @tanstack/playbook install --package query --package router

✔ Installed 8 skills to .agents/skills/

Add the following to your AGENTS.md:

─────────────────────────────────────────────────
## Included Playbooks

### TanStack Playbook
Skills for TanStack Query and Router are installed in `.agents/skills/`.

Load each library's router skill first when working with that library:

Package skills installed (load the router skill for each library first):
  → tanstack-query/core        (useQuery, useMutation, QueryClient)
  → tanstack-query/caching     (staleTime, gcTime, invalidation)
  → tanstack-query/infinite    (useInfiniteQuery)
  → tanstack-query/suspense    (useSuspenseQuery)
  → tanstack-router/core       (routes, navigation, params)
  → tanstack-router/loaders    (beforeLoad, loader, prefetching)
  → tanstack-router/search-params (type-safe search params)
  → tanstack-router/with-query (Router + Query composition)

All skills cover the React adapter only.
─────────────────────────────────────────────────
```

The snippet is tailored to which packages were installed. Installing all packages produces a full listing; installing `--package query` only lists Query skills.

#### Thin Skill Pattern

The installed thin skill is a minimal shell that points back to the npm package for the full content:

```markdown
---
name: tanstack-query/router
description: Entry point for TanStack Query. Routes to the correct Query skill.
---

# TanStack Query — Router

Full skill content is in the @tanstack/playbook npm package.

\`\`\`bash
npx @tanstack/playbook show tanstack-query/router
\`\`\`

Query skills: tanstack-query/router, tanstack-query/core, tanstack-query/caching,
  tanstack-query/infinite, tanstack-query/suspense

\`\`\`bash
npx @tanstack/playbook list --package query
\`\`\`
```

#### CLI Commands

| Command | Description |
|---|---|
| `npx @tanstack/playbook install` | Install all skills; prompts for detected agent dirs |
| `npx @tanstack/playbook install --package <pkg>` | Install skills for one package |
| `npx @tanstack/playbook install --package <p> --package <p>` | Install multiple packages |
| `npx @tanstack/playbook install --global` | Install to user-level directories |
| `npx @tanstack/playbook list` | List all available skills |
| `npx @tanstack/playbook list --package <pkg>` | List skills for one package |
| `npx @tanstack/playbook show <skill-name>` | Print full skill content |

---

### Release Sequence

1. Bootstrap all skills using the generation prompt against React docs
2. Review and merge generated skills into `@tanstack/playbook`
3. Publish `@tanstack/playbook` to npm
4. Add `notify-playbook.yml` GitHub Action to each package repo
5. Configure Oz automation in playbook repo
6. Validate at onsite

**If pressed for time, 90/10 cut:** One `router` skill + one `core` skill per library covers the primary use case. Caching, infinite, suspense, and composition skills follow once core is validated.

---

## Open Questions

| Question | Options | Resolution Path |
|---|---|---|
| **Oz multi-repo access** | Oz needs read access to 5 package repos — confirm permissions model | Check Oz docs for multi-repo environment config |
| **Electric integration ownership** | `db-electric` skill in playbook vs Electric's own playbook | Coordinate with Electric team; avoid duplicate guidance |
| **File-based vs code-based routing** | Separate skills or in `tanstack-router/core`? | Assess volume; split if content exceeds 300 lines |
| **Cross-skill cascade depth** | One level of cross-skill staleness checking vs recursive | Start at one level; expand if gaps are found in practice |

---

## Definition of Success

### Primary Hypothesis

> We believe that publishing TanStack agent skills will help developers build TanStack apps faster and avoid common mistakes.
>
> We'll know we're right if:
>
> - `@tanstack/playbook` gets meaningful npm downloads (>100 in first month)
> - Qualitative feedback indicates skills guided correct package/adapter selection or unlocked a composition
> - AGENTS.md snippet is being added to projects (visible in public repos)
>
> We'll know we're wrong if:
>
> - Downloads are negligible
> - Feedback indicates skills are too generic or don't cover actual error cases
> - Developers ignore the router skill and rely on general agent knowledge

### Functional Requirements

| Requirement | Acceptance Criteria |
|---|---|
| Playbook published | `@tanstack/playbook` installable via npm |
| Router skills work | Each library's router skill routes agent to the correct skill within that library |
| All package skills present | query, router, db, form, table skills all present and generated from React docs |
| Thin skills install correctly | `npx @tanstack/playbook install` installs to `.agents/skills/` and prompts for others |
| AGENTS.md snippet emitted | Install command outputs correct snippet for installed packages |
| CLI commands work | `list`, `show`, `install --package` all work correctly |
| CI trigger works | Merge to package repo fires webhook to Oz |
| Oz staleness check works | Oz evaluates skill, rewrites if stale, opens PR; silent if not |
| Cross-skill check works | Updating a skill triggers evaluation of skills that reference it |

### Learning Goals

1. Do agents follow the router skill's routing table, or do they load skills directly?
2. Which package skills see the most usage?
3. Which compositions are most under-served by current skill content?
4. Does the AGENTS.md snippet get added — and does it help agents find skills?
