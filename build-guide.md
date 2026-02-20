# @tanstack/playbook — Build Guide

Step-by-step instructions for building the `@tanstack/playbook` repo from scratch. Each phase is a discrete, self-contained task that can be handed directly to a coding agent. Complete phases in order — each one depends on the previous.

The RFC at `tanstack-playbook-rfc.md` is the source of truth for design decisions. When this guide and the RFC conflict, the RFC wins.

---

## Phase 1: Repo Scaffold

**What you're doing:** Creating the repo skeleton — directory structure, `package.json`, TypeScript config, and a `registry.json` that is the source of truth for all skills. No content yet, just the right shape.

**Hand to agent:**

> Set up the `@tanstack/playbook` repo from scratch. Do the following exactly:
>
> 1. `npm init -y`. Set `"name": "@tanstack/playbook"`, `"type": "module"`, `"version": "0.0.1"`. Add `"bin": { "tanstack-playbook": "./dist/cli.js" }`. Add `"files": ["dist", "skills"]`. Add scripts: `"build": "tsc"`, `"dev": "tsx src/cli.ts"`.
>
> 2. Install dev deps: `npm install -D typescript tsx @types/node`.
>
> 3. Create `tsconfig.json`: target `ESNext`, `moduleResolution: "bundler"`, `outDir: "./dist"`, `rootDir: "./src"`, `strict: true`.
>
> 4. Create `.gitignore` ignoring `node_modules` and `dist`.
>
> 5. Create the following directory tree. Every empty leaf directory gets a `.gitkeep`:
>
> ```
> skills/
>   tanstack-query/
>     router/
>     core/
>       references/
>     caching/
>       references/
>     infinite/
>     suspense/
>   tanstack-router/
>     router/
>     core/
>       references/
>     search-params/
>     loaders/
>     with-query/
>   tanstack-db/
>     router/
>     core/
>     optimistic/
>     electric/
>   tanstack-form/
>     router/
>     core/
>       references/
>     async/
>     submission/
>   tanstack-table/
>     router/
>     core/
>       references/
>     features/
>     virtual/
>   internal/
>     skill-staleness-check/
> prompts/
> src/
> .warp/
>   automations/
> .github/
>   workflows/
> ```
>
> 6. Create `skills/registry.json`. This is the single source of truth for all skills — the CLI reads from it, the install command reads from it, and the Oz automation reads from it. Leave `description` empty for now; it gets filled in during skill generation.
>
> ```json
> {
>   "skills": [
>     { "name": "tanstack-query/router",        "package": "query",  "internal": false, "description": "" },
>     { "name": "tanstack-query/core",           "package": "query",  "internal": false, "description": "" },
>     { "name": "tanstack-query/caching",        "package": "query",  "internal": false, "description": "" },
>     { "name": "tanstack-query/infinite",       "package": "query",  "internal": false, "description": "" },
>     { "name": "tanstack-query/suspense",       "package": "query",  "internal": false, "description": "" },
>     { "name": "tanstack-router/router",        "package": "router", "internal": false, "description": "" },
>     { "name": "tanstack-router/core",          "package": "router", "internal": false, "description": "" },
>     { "name": "tanstack-router/search-params", "package": "router", "internal": false, "description": "" },
>     { "name": "tanstack-router/loaders",       "package": "router", "internal": false, "description": "" },
>     { "name": "tanstack-router/with-query",    "package": "router", "internal": false, "description": "" },
>     { "name": "tanstack-db/router",            "package": "db",     "internal": false, "description": "" },
>     { "name": "tanstack-db/core",              "package": "db",     "internal": false, "description": "" },
>     { "name": "tanstack-db/optimistic",        "package": "db",     "internal": false, "description": "" },
>     { "name": "tanstack-db/electric",          "package": "db",     "internal": false, "description": "" },
>     { "name": "tanstack-form/router",          "package": "form",   "internal": false, "description": "" },
>     { "name": "tanstack-form/core",            "package": "form",   "internal": false, "description": "" },
>     { "name": "tanstack-form/async",           "package": "form",   "internal": false, "description": "" },
>     { "name": "tanstack-form/submission",      "package": "form",   "internal": false, "description": "" },
>     { "name": "tanstack-table/router",         "package": "table",  "internal": false, "description": "" },
>     { "name": "tanstack-table/core",           "package": "table",  "internal": false, "description": "" },
>     { "name": "tanstack-table/features",       "package": "table",  "internal": false, "description": "" },
>     { "name": "tanstack-table/virtual",        "package": "table",  "internal": false, "description": "" },
>     { "name": "internal/skill-staleness-check", "package": null,    "internal": true,  "description": "" }
>   ]
> }
> ```
>
> 7. Create `README.md` with one line: `# @tanstack/playbook`. Will be filled out in Phase 9.
>
> 8. `git init`, `git add .`, `git commit -m "chore: initial scaffold"`.

**Done when:** Directory tree exists, `skills/registry.json` is in place, `npm run build` runs without errors.

---

## Phase 2: CLI — list and show

**What you're doing:** Building the CLI that powers `list` and `show`. These two commands work off `registry.json` and the SKILL.md files on disk. No install logic yet.

**Hand to agent:**

> Build the CLI for `@tanstack/playbook`. Entry point: `src/cli.ts`. Use Node built-ins (`fs`, `path`) only — no additional dependencies.
>
> **`src/registry.ts`** — shared module used by CLI and install command:
> - `getSkills(packageFilter?: string)` — returns all non-internal registry entries, optionally filtered by `package` field
> - `getSkill(name: string)` — returns a single entry or null
> - `getSkillPath(name: string)` — returns the absolute path to that skill's SKILL.md
>
> Skill name `<library>/<skill>` maps to `skills/<library>/<skill>/SKILL.md` relative to the package root. Resolve the package root using `import.meta.url`, not `process.cwd()`.
>
> **`list` command** — prints all non-internal skills, one per line, `name` padded then `description`.
> `--package <n>` filters to skills where the `package` field matches.
>
> Example output:
> ```
> $ npx @tanstack/playbook list --package <library>
> <library>/router      Entry point for TanStack <Library> work
> <library>/core        ...
> <library>/...         ...
> ```
>
> **`show <skill-name>` command** — reads and prints the full SKILL.md to stdout.
> If the skill is not in the registry or the file doesn't exist on disk, print a clear error and exit with code 1.
>
> Example:
> ```
> $ npx @tanstack/playbook show <library>/core
> [full SKILL.md content]
>
> $ npx @tanstack/playbook show <library>/does-not-exist
> Error: skill "<library>/does-not-exist" not found
> ```
>
> Wire the binary in `package.json` `bin` field to `./dist/cli.js`.

**Done when:** `npx @tanstack/playbook list` prints all 22 registry entries (descriptions empty for now). `npx @tanstack/playbook show <any-skill>` fails clearly since no SKILL.md files exist yet.

---

## Phase 3: Generation Prompt File

**What you're doing:** Committing the skill generation prompt to the repo before generating any skills, so the prompt itself is version-controlled and reviewable.

**Hand to agent:**

> Create `prompts/generate-skill.md` with two parts.
>
> **Part 1 — the prompt itself:**
>
> ````markdown
> # Skill Generation Prompt
>
> You are generating a SKILL.md file for the `@tanstack/playbook` agent skills repo.
> Skills in this repo are written for coding agents (Claude Code, Cursor, Warp Oz),
> not for human readers. Your output will be loaded into an agent's context window
> and used to guide code generation.
>
> ## Your task
>
> Generate a complete SKILL.md for the skill named: **{SKILL_NAME}**
> Use the format `library-group/skill-name`, e.g. `tanstack-<library>/core`.
>
> The skill covers: **{SKILL_DESCRIPTION}**
>
> Source documentation to distill from:
> {SOURCE_DOCS}
>
> ## Output requirements
>
> ### 1. Frontmatter
>
> ```yaml
> ---
> name: {SKILL_NAME}
> description: >
>   One to three sentences. What this skill covers and exactly when an agent
>   should load it. Written for the agent — include the keywords an agent would
>   encounter when it needs this skill.
> triggers:
>   - list
>   - of
>   - keywords
> metadata:
>   sources:
>     - 'repo:path/to/source/file'   # format: repo-name:relative-path, globs ok
>   skills:
>     - other-skill/name             # only if this skill references another skill
> ---
> ```
>
> ### 2. A minimal setup example
>
> A complete, copy-pasteable code block showing the minimum viable usage.
> No placeholder comments. No unnecessary boilerplate. React adapter only.
> Import from the correct `@tanstack/react-*` package.
>
> ### 3. The primary patterns
>
> The one to three most important things an agent needs to know to use this correctly.
> Each pattern must include a working code example.
> Do not explain what the agent already knows (TypeScript, React hooks, etc).
> Only write what is specific to this TanStack library and skill.
>
> ### 4. Common Mistakes
>
> A "Common Mistakes" section with at least three entries. Each entry must show:
> - ❌ The wrong pattern with a code example
> - ✅ The correct pattern with a code example
> - A one-line explanation of why the wrong pattern fails
>
> Focus on mistakes that produce plausible-looking but broken or subtly incorrect code.
>
> ### 5. Resources (only if needed)
>
> If detailed API options or exhaustive type signatures are important but too long
> for the main skill, list them as references:
>
> ```markdown
> ## Resources
> - [Full option reference](references/api.md)
> ```
>
> Omit this section entirely if the skill is complete without it.
>
> ## Constraints
>
> - Total SKILL.md must be under 500 lines
> - React adapter only — no Vue, Solid, Svelte, or Angular examples
> - All imports must use the real package name (e.g. `@tanstack/react-<library>`)
> - No marketing copy, no motivational prose
> - No explanations of TypeScript or React concepts the agent already knows
> - Every code example must be complete enough to copy-paste without modification
> ````
>
> **Part 2 — usage and review checklist:**
>
> ```markdown
> ## Usage
>
> 1. Open this prompt in your agent (Claude Code, Cursor, etc.)
> 2. Fill in the three placeholders:
>    - `{SKILL_NAME}` — e.g. `tanstack-<library>/core` (library/skill-name format)
>    - `{SKILL_DESCRIPTION}` — one sentence describing the skill's scope
>    - `{SOURCE_DOCS}` — paste the relevant documentation pages in full
> 3. Run the prompt. Save output to `skills/<library>/<skill>/SKILL.md`
> 4. Update `skills/registry.json` with the `description` from the generated frontmatter
> 5. Verify the skill passes the review checklist below
>
> ## Review Checklist
>
> - [ ] Valid YAML frontmatter: name, description, triggers, metadata.sources, metadata.skills
> - [ ] `name` matches the directory path exactly
> - [ ] At least one complete, copy-pasteable code example (no `...` or `[placeholder]`)
> - [ ] Common Mistakes — at least 3 entries, each with ❌ wrong + ✅ correct + explanation
> - [ ] Under 500 lines total
> - [ ] React adapter only — all imports from `@tanstack/react-*`
> - [ ] No concept explanations the agent already knows
> - [ ] `metadata.sources` entries use `repo:path` format
> - [ ] `metadata.skills` lists any other playbook skills this skill references
> - [ ] `npx @tanstack/playbook show <skill-name>` prints the skill correctly after adding it
> ```

**Done when:** `prompts/generate-skill.md` exists with both parts committed.

---

## Phase 4: Generate All Skills

**What you're doing:** Using the generation prompt to create every skill across all five libraries. The `router` skill for each library is always generated first — it needs to know all the other skills in its library to write the routing table.

**How to run the prompt:**

For each skill, use the prompt from `prompts/generate-skill.md`. Fill in `{SKILL_NAME}`, `{SKILL_DESCRIPTION}`, and `{SOURCE_DOCS}`. Save the output to the correct path and update `registry.json` with the description.

**Source docs to fetch — get these before starting:**

| Library | Docs pages to fetch |
|---|---|
| tanstack-query | tanstack.com/query/latest/docs/framework/react/{overview, guides/queries, guides/query-keys, guides/mutations, guides/query-invalidation, guides/caching, guides/infinite-queries, guides/suspense} |
| tanstack-router | tanstack.com/router/latest/docs/framework/react/{overview, guide/routing-concepts, guide/navigation, guide/search-params, guide/data-loading} |
| tanstack-db | tanstack.com/db/latest/docs/{overview, guide/collections, guide/queries, guide/mutations, guide/optimistic-mutations} |
| tanstack-form | tanstack.com/form/latest/docs/framework/react/{overview, guides/basic-concepts, guides/validation, guides/async-validation, guides/submission} |
| tanstack-table | tanstack.com/table/latest/docs/{introduction, guide/column-defs, guide/sorting, guide/filtering, guide/pagination, guide/virtualization} |

**Order within each library:** always generate `router` first, then the remaining skills in any order. The router skill needs all other skills listed in its routing table.

**Special case — `tanstack-router/with-query`:** This skill crosses two libraries. Its `metadata.skills` must include both `tanstack-query/core` and `tanstack-router/loaders`. Use docs from both libraries as source material.

**Skills to generate (22 total):**

| Library | Skills |
|---|---|
| tanstack-query | router, core, caching, infinite, suspense |
| tanstack-router | router, core, search-params, loaders, with-query |
| tanstack-db | router, core, optimistic, electric |
| tanstack-form | router, core, async, submission |
| tanstack-table | router, core, features, virtual |

**Review checklist (apply to every skill before moving on):**

- [ ] Valid YAML frontmatter: name, description, triggers, metadata.sources, metadata.skills
- [ ] `name` matches directory path exactly
- [ ] At least one complete, copy-pasteable code example
- [ ] Common Mistakes section with at least 3 entries
- [ ] Under 500 lines
- [ ] React adapter only — all imports from `@tanstack/react-*`
- [ ] Each library's `router` skill routing table covers all other skills in that library
- [ ] `registry.json` descriptions filled in for every skill

**Done when:** All 22 SKILL.md files exist on disk, pass the review checklist, and `npx @tanstack/playbook list` shows all of them with descriptions.

---

## Phase 5: CLI — install Command

**What you're doing:** Adding the `install` command — writes thin skills to agent directories and emits the AGENTS.md snippet.

**Hand to agent:**

> Add an `install` command to `src/cli.ts`.
>
> **Which skills to install:**
> `--package <n>` (repeatable). Valid values: `query`, `router`, `db`, `form`, `table`.
> No `--package` flag means install all non-internal skills.
> Always include the `router` skill for each package being installed.
>
> **Where to install:**
> Primary target: `.agents/skills/` in `process.cwd()`. Always install here.
> Detect additional targets by checking if these dirs exist in `process.cwd()`:
> - `.claude/` → `.claude/skills/`
> - `.cursor/` → `.cursor/skills/`
> - `.codex/` → `.codex/skills/`
> - `.windsurf/` → `.windsurf/skills/`
> - `.github/` → `.github/skills/`
>
> If additional targets are detected, list them and ask: `Install to these as well? (Y/n)`.
> `--yes` skips the prompt. `--global` installs to `~/.agents/skills/` instead.
>
> **Thin skill content:**
> For each skill write a thin SKILL.md at `<target>/<skill-name>/SKILL.md`.
> Create parent directories as needed.
>
> Template:
> ```
> ---
> name: <skill-name>
> description: <description from registry.json>
> ---
>
> # <skill-name>
>
> Full content is in the @tanstack/playbook npm package.
>
> ```bash
> npx @tanstack/playbook show <skill-name>
> ```
>
> To list all skills for this library:
>
> ```bash
> npx @tanstack/playbook list --package <package>
> ```
> ```
>
> **AGENTS.md snippet:**
> Print after installing, tailored to what was installed:
>
> ```
> ✔ Installed X skills to .agents/skills/
>
> Add the following to your AGENTS.md:
>
> ─────────────────────────────────────────────────
> ## Included Playbooks
>
> ### TanStack Playbook
> Skills are installed in `.agents/skills/`.
> Load each library's router skill first when working with that library.
>
> [list each installed skill with its one-line description]
>
> All skills cover the React adapter only.
> ─────────────────────────────────────────────────
> ```
>
> Descriptions come from `registry.json`. Group the listing by library in the output.

**Done when:** Running `npx @tanstack/playbook install --package <library>` in a test directory creates the correct `.agents/skills/<library>/{router,...}/SKILL.md` files and prints the correct snippet — for every valid `--package` value.

---

## Phase 6: Internal Staleness-Check Skill

**What you're doing:** Writing the `internal/skill-staleness-check` SKILL.md — the Oz agent's operating instructions for keeping skills current. Not installed to users.

**Hand to agent:**

> Create `skills/internal/skill-staleness-check/SKILL.md`. This skill is the Oz automation's step-by-step procedure. Write it for an autonomous agent, not a human. It must be unambiguous enough to follow without clarification.
>
> Cover all of the following in order:
>
> **Inputs:** Webhook payload — `package` (e.g. `@tanstack/<library>`), `sha` (commit SHA), `changed_files` (array of relative file paths that changed).
>
> **Step 1 — Map files to skills:**
> Parse frontmatter from every SKILL.md in `skills/` excluding `skills/internal/`.
> Build a lookup: `metadata.sources` entries → skill name.
> Sources use `repo:path` format and support globs.
> Match `changed_files` from the payload against this lookup.
>
> **Step 2 — Evaluate each matched skill:**
> For each match: fetch current SKILL.md + the diff for the changed file from the source repo at the given SHA.
> Decide: does this diff change behavior, an API, a pattern, or an example that this skill documents?
> If YES: rewrite the skill. Preserve all sections. Stay under 500 lines. React adapter only. Keep all working examples and Common Mistakes intact.
> If NO: skip. Do not open a PR.
>
> **Step 3 — Cross-skill cascade (one level only):**
> For each skill rewritten in Step 2: scan all other skills for `metadata.skills` entries listing the updated skill.
> For each skill that references it: evaluate for staleness. Rewrite and open a PR if stale; skip silently if not.
> Do not recurse — only one level of cascade.
>
> **Step 4 — Open PRs:**
> For each rewritten skill: branch `skill-update/<skill-name-with-dashes>-<7-char-sha>`, commit updated SKILL.md, open PR against main.
> PR title: `skill: update <skill-name> (<package>@<short-sha>)`
> PR body sections: Triggered by / What changed in source / What changed in skill / Cross-skill impact / Review checklist.
>
> **No-op rule:** If no files match any skill's sources, or if matched diffs don't affect documented behavior, exit silently. No PR, no output, no notification.

**Done when:** `skills/internal/skill-staleness-check/SKILL.md` exists and covers all four steps and the no-op rule without ambiguity.

---

## Phase 7: Oz Config + GitHub Actions Template

**What you're doing:** Creating the Warp Oz automation config and the GitHub Actions template that each package repo will use to fire the webhook.

**Hand to agent:**

> Create two files:
>
> **`.warp/automations/skill-check.yml`:**
> ```yaml
> name: Skill Staleness Check
> trigger: webhook
> skill: skills/internal/skill-staleness-check/SKILL.md
> environments:
>   - repo: YOUR_ORG/playbook    # TODO: replace with actual org
>   - repo: TanStack/query
>   - repo: TanStack/router
>   - repo: TanStack/db
>   - repo: TanStack/form
>   - repo: TanStack/table
> ```
>
> **`.github/workflows/notify-playbook.template.yml`** — template to copy into each package repo:
> ```yaml
> name: Notify Playbook
>
> on:
>   push:
>     branches: [main]
>
> jobs:
>   dispatch:
>     runs-on: ubuntu-latest
>     steps:
>       - uses: actions/checkout@v4
>         with:
>           fetch-depth: 2
>
>       - name: Get changed files
>         id: diff
>         run: |
>           echo "files=$(git diff --name-only HEAD~1 HEAD | jq -R -s -c 'split("\n")[:-1]')" >> $GITHUB_OUTPUT
>
>       - name: Trigger Oz skill check
>         run: |
>           curl -X POST "${{ secrets.OZ_WEBHOOK_URL }}" \
>             -H "Authorization: Bearer ${{ secrets.OZ_WEBHOOK_TOKEN }}" \
>             -H "Content-Type: application/json" \
>             -d '{
>               "package": "@tanstack/REPLACE_WITH_PACKAGE_NAME",
>               "sha": "${{ github.sha }}",
>               "changed_files": ${{ steps.diff.outputs.files }}
>             }'
> ```
>
> Then add a `## CI Setup` section to `README.md` explaining:
> - Copy the template into each package repo as `.github/workflows/notify-playbook.yml`
> - Replace `REPLACE_WITH_PACKAGE_NAME` with the package name
> - Add `OZ_WEBHOOK_URL` and `OZ_WEBHOOK_TOKEN` as secrets in each package repo (obtained from Oz after creating the automation)

**Done when:** Both files exist and the README CI Setup section is clear.

---

## Phase 8: Polish and Publish

**What you're doing:** Final README, build verification, and publishing to npm.

**Hand to agent:**

> Complete the following before publishing:
>
> 1. **Write `README.md`** with these sections:
     >    - One paragraph describing what `@tanstack/playbook` is
>    - Quick start: install command with `--package` examples for each library
>    - CLI reference table (`list`, `list --package`, `show`, `install`, `install --package`, `install --global`)
>    - Example AGENTS.md snippet output (use any library as the example — keep it generic)
>    - Link to the RFC for full architecture details
>    - CI Setup section (from Phase 7)
>
> 2. **Build:** `npm run build`. Fix any TypeScript errors. Confirm `dist/cli.js` exists.
>
> 3. **Smoke test every package:**
     >    - `node dist/cli.js list` — all 22 skills listed with descriptions
>    - `node dist/cli.js list --package <each of: query, router, db, form, table>` — correct subset each time
>    - `node dist/cli.js show <one skill from each library>` — prints correctly
>    - `node dist/cli.js install --package <each library>` in a tmp dir — creates correct `.agents/skills/` structure and prints snippet
>
> 4. **Set version to `0.1.0`**. Add `"description": "Agent skills for the TanStack ecosystem"`. Add `"keywords": ["tanstack", "agents", "skills", "ai", "playbook"]`.
>
> 5. `npm publish --access public`

**Done when:** `npx @tanstack/playbook list` works for anyone. Package is live on npm.

---

## Phase 9: Wire Package Repos

**What you're doing:** Adding the `notify-playbook.yml` GitHub Action to each TanStack package repo. This requires PR access to repos you may not own — do this manually.

**Steps (repeat for each of the five package repos):**

1. Copy `.github/workflows/notify-playbook.template.yml` into the target repo as `.github/workflows/notify-playbook.yml`
2. Replace `REPLACE_WITH_PACKAGE_NAME` with the correct value (`query`, `router`, `db`, `form`, or `table`)
3. Add repository secrets: `OZ_WEBHOOK_URL` and `OZ_WEBHOOK_TOKEN` (get these from Oz after setting up the automation in Phase 7)
4. Open a PR and merge it

**Verify end-to-end:** After all five repos are wired, make a trivial doc change in one package repo and confirm the webhook fires, Oz receives the payload, evaluates the affected skill, and either opens a PR or exits silently. Check the Oz dashboard for the run log.

**Done when:** All five repos have the workflow and a test run confirms the full pipeline.

---

## Summary

| Phase | What | Who |
|---|---|---|
| 1 | Repo scaffold, directory structure, registry.json | Agent |
| 2 | CLI: list + show | Agent |
| 3 | Generation prompt file + review checklist | Agent |
| 4 | Generate all 22 skills | Agent with prompt |
| 5 | CLI: install + AGENTS.md snippet | Agent |
| 6 | Internal staleness-check skill | Agent |
| 7 | Oz config + GitHub Actions template | Agent |
| 8 | README, build, publish | Agent |
| 9 | Wire up package repos | Manual |
