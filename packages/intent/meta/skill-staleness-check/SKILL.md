---
name: skill-staleness-check
description: >
  Use when reviewing an upstream TanStack webhook payload containing the package, commit SHA, and changed files for stale skill guidance. For ordinary library changes or Intent review reports, use generate-skill instead.
metadata:
  purpose: >
    Evaluate intent skills for staleness when source files change in upstream TanStack package repos. Matches changed files against metadata.sources, evaluates whether diffs affect documented behavior, rewrites stale skills using generate-skill, checks cross-skill references, and opens PRs. Silent when nothing needs updating.
  version: '1.0'
  category: meta-tooling
  input_artifacts: 'webhook payload (package name, commit SHA, changed files)'
  output_artifacts: 'updated SKILL.md files; pull requests'
  skills: 'generate-skill; tree-generator'
---

# Skill Staleness Check

You are a coding agent. Your job is to evaluate whether intent skills are
stale after upstream source changes, and if so, update them and open PRs.
You act autonomously end-to-end. PRs contain already-updated skill
content, not suggestions.

If nothing needs updating, exit silently. No PR, no notification.

---

## Inputs

Webhook payload from an upstream package repo merge to main:

```json
{
  "package": "@tanstack/query",
  "sha": "abc123",
  "changed_files": ["docs/framework/react/guides/queries.md", "src/query.ts"]
}
```

---

## Step 1 — Match changed files to skills

Read all SKILL.md files under `packages/intent/skills/`. For each skill,
extract `sources` from the frontmatter.

Match `changed_files` from the webhook against `sources` entries across all
skills. Source references use the format `Owner/repo:relative-path` and
support glob patterns.

A skill is a **candidate** if any of its `sources` entries match a changed
file.

If no skills match, exit silently.

### Using `intent stale`

There is no separate sync script — `intent stale [dir] [--json]` is the real,
existing staleness signal (see `docs/cli/intent-stale.md`). It is **read-only**:
it reports drift, it does not write anything. For a given library:

```bash
intent stale packages/query --json
```

This reports:

- Library version drift (`library_version` in a skill's frontmatter vs the
  currently published version), classified `major`/`minor`/`patch`.
- Missing source SHAs recorded in that package's `skills/sync-state.json`
  (a conservative signal — it flags gaps in the stored SHA record, not
  actual remote content differences; see the doc's Notes section).

`intent stale` does not classify "needs regeneration" vs "version bump only"
the way a dedicated sync tool might — that classification is this skill's own
job, done in Step 2 below using the actual source diff, not `intent stale`'s
output alone.

---

## Step 2 — Evaluate each candidate

For each matched skill:

1. Read the current SKILL.md content
2. Fetch the file diff from the triggering commit in the source repo
3. Classify the change:

| Classification        | Criteria                                                                                      | Action                                      |
| --------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------- |
| **No impact**         | Diff is typo fix, comment change, test-only, or internal refactor with no API/behavior change | Skip — no update needed                     |
| **Version bump only** | Diff changes version numbers, dependency ranges, or metadata but no documented behavior       | Bump `library_version` in frontmatter       |
| **Content update**    | Diff changes API shape, behavior, defaults, types, or patterns that the skill documents       | Rewrite affected sections                   |
| **Breaking change**   | Diff removes, renames, or fundamentally changes an API the skill documents                    | Rewrite + add old pattern as Common Mistake |

### Two-pass classification

**Pass 1 — Quick scan:** Read the diff summary (files changed, insertions,
deletions). Identify which skill sections could be affected.

**Pass 2 — Detail evaluation:** For each potentially affected section, read
the full diff hunks and compare against the skill content. Determine if the
change actually affects what the skill documents.

This prevents over-updating. A 200-line diff to a source file may only
affect one line of one skill, or none at all.

---

## Step 3 — Update stale skills

For skills classified as needing content updates:

1. Load the generate-skill meta skill
2. Provide it with:
   - The existing SKILL.md content
   - The source diff
   - The current source documentation (fetch the updated file)
3. Use regeneration mode (surgical update, not full rewrite)
4. Validate the updated skill against all checks

For version bump only:

There is no write-capable script for this. Edit `library_version` directly
in each affected skill's frontmatter, then update the recorded SHA(s) for
that library in its `skills/sync-state.json` (see Step 5) to reflect the new
synced state.

---

## Step 4 — Check cross-skill references

After updating skills in Step 3, check for cross-skill staleness:

1. For each skill that was updated, read its `name`
2. Scan all other skills for `requires` entries or `sources` that reference
   the updated skill
3. For each skill that references an updated skill, evaluate whether the
   update makes the referencing skill stale or inconsistent
4. If stale → update using the same process as Step 3
5. If not → skip

This cascade is bounded to **one level**. Skills that reference a
second-order dependency are not automatically re-checked.

---

## Step 5 — Mark skills as synced

There is no write-capable script for this either. After updating a skill,
edit that library's `skills/sync-state.json` directly: update
`library_version` and the affected skill's `skills[skillName].sources_sha`
map with the new source file SHA(s) from the commit that triggered this run.
(That is the real current shape read by `intent stale` — it has no separate
tree-generator SHA or sync-timestamp field, despite what an earlier version
of this doc implied.)

---

## Step 6 — Open PRs

For each skill (or group of skills) that was updated:

1. Create branch: `skill-update/<skill-name>-<short-sha>`
2. Commit updated SKILL.md file(s)
3. Open PR with structured body

### PR format

**Title:** `skill: update <skill-name> (<package>@<short-sha>)`

**Body:**

```markdown
### Triggered by

Changes to: <list of source files that matched>

### What changed in the source

<summary of the diff — 2–3 sentences max>

### What changed in the skill

<summary of skill edits — which sections were updated and why>

### Cross-skill impact

<list any downstream skills checked; note if PRs were opened for them>

### Review checklist

- [ ] Skill content is accurate
- [ ] Code examples are complete and copy-pasteable
- [ ] No other skills need corresponding updates
- [ ] Under 500 lines
```

### Grouping PRs

- If multiple skills for the same library are affected by the same commit,
  group them in a single PR
- If a cross-skill update is needed (Step 4), open a separate PR for the
  downstream skill to keep review scopes clean
- Never mix skills from different libraries in the same PR

---

## No-op behavior

Exit silently (no PR, no notification, no issue) when ANY of these are true:

- No changed files match any skill's `sources`
- All matched diffs are classified as "no impact" in Step 2
- `intent stale` reports all skills up-to-date (`All skills up-to-date`, per
  `docs/cli/intent-stale.md`)

---

## Operational notes

### GitHub API usage

This skill (not a separate script) uses the `gh` CLI directly for GitHub API
access — fetching source diffs in Step 2 and opening PRs in Step 6. It
requires:

- `gh` CLI installed and authenticated
- Read access to upstream TanStack package repos (query, router, db, form,
  table)
- Write access to the intent repo for creating branches and PRs

### Rate limiting

When checking multiple libraries or many source files, this makes one API
call per source file per skill during Step 2's diff fetch. For large
batches, the GitHub API rate limit (5000 requests/hour for authenticated
users) may apply. There is no batching or response caching in place — if
this becomes an issue, add caching around the diff-fetch step.

### Manual triggering

Maintainers can run the read-only staleness signal manually, outside the
webhook-triggered flow:

```bash
# Check a specific library
intent stale packages/db

# JSON output
intent stale packages/db --json
```

This only reports drift (version drift, missing source SHAs) — it does not
update `sync-state.json` or open PRs; those remain Step 5 and Step 6 of this
skill's own workflow, done manually as described above.

---

## Constraints

| Rule                                            | Detail                                              |
| ----------------------------------------------- | --------------------------------------------------- |
| Silent when nothing changes                     | No noise — exit cleanly if no updates needed        |
| Surgical updates over full rewrites             | Only change sections affected by the diff           |
| One cascade level                               | Cross-skill checks go one level deep, not recursive |
| PRs scoped to one library                       | Never mix libraries in a single PR                  |
| Version bumps are separate from content updates | A version-only bump doesn't require regeneration    |
| Commit messages include co-author               | Include the coding agent's co-author tag            |
