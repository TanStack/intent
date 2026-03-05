---
name: skill-staleness-check
description: >
  Evaluate intent skills for staleness when source files change in upstream
  TanStack package repos. Matches changed files against metadata.sources,
  evaluates whether diffs affect documented behavior, rewrites stale skills
  using skill-generate, checks cross-skill references, and opens PRs.
  Silent when nothing needs updating.
metadata:
  version: '1.0'
  category: meta-tooling
  input_artifacts:
    - webhook payload (package name, commit SHA, changed files)
  output_artifacts:
    - updated SKILL.md files
    - pull requests
  skills:
    - skill-generate
    - skill-tree-generator
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

### Using sync-skills.mjs

The repo includes `scripts/sync-skills.mjs` for programmatic staleness
detection. For a given library:

```bash
node scripts/sync-skills.mjs <library>
```

This checks:

- Source file SHA drift (compares stored SHAs in `sync-state.json` against
  current remote SHAs via GitHub API)
- Library version drift (frontmatter `library_version` vs current published
  version)
- Tree-generator changes (whether the meta skill has been updated since
  last sync)

Use `--report` to write a structured `staleness_report.yaml`:

```bash
node scripts/sync-skills.mjs <library> --report
```

The report classifies skills as needing regeneration (source changed) or
version bump only.

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

1. Load the skill-generate meta skill
2. Provide it with:
   - The existing SKILL.md content
   - The source diff
   - The current source documentation (fetch the updated file)
3. Use regeneration mode (surgical update, not full rewrite)
4. Validate the updated skill against all checks

For version bump only:

```bash
node scripts/sync-skills.mjs <library> --bump-version <new-version>
```

This updates `library_version` in all frontmatter for the library and
records the new version in `sync-state.json`.

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

After updating, mark the affected skills as synced so future staleness
checks have a clean baseline:

```bash
# Mark specific skills
node scripts/sync-skills.mjs <library> --mark-synced <skill1> <skill2>

# Mark all skills for a library
node scripts/sync-skills.mjs <library> --mark-synced --all
```

This updates `sync-state.json` with current source file SHAs, the
tree-generator SHA, and the sync timestamp.

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
- The sync-skills.mjs report shows all skills are current

---

## Operational notes

### GitHub API usage

The `sync-skills.mjs` script uses the `gh` CLI for GitHub API access. It
requires:

- `gh` CLI installed and authenticated
- Read access to upstream TanStack package repos (query, router, db, form,
  table)
- Write access to the intent repo for creating branches and PRs

### Rate limiting

When checking multiple libraries or many source files, the script makes
one API call per source file per skill. For large batches, the GitHub API
rate limit (5000 requests/hour for authenticated users) may apply. The
script does not currently batch or cache API responses — if this becomes
an issue, add caching at the `getRemoteFileSha` level.

### Manual triggering

Maintainers can run staleness detection manually:

```bash
# Check a specific library
node scripts/sync-skills.mjs db

# Check and write a report
node scripts/sync-skills.mjs db --report

# After reviewing and regenerating, mark as synced
node scripts/sync-skills.mjs db --mark-synced --all
```

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
