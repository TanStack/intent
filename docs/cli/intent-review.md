---
title: intent review
id: intent-review
---

`intent review` shows which library skills and planning records need review after source changes. Completed reviews are remembered until their source or guidance changes again.

```bash
npx @tanstack/intent@latest review [dir] [--base <ref>] [--json] [--check] [--record <report.json>] [--github-review] [--package-label <label>]
```

For the normal coding-agent workflow, enable [maintainer installation](./intent-install#maintainer-workflow) once. The installed guidance instructs the agent to review guidance and maintain the planning documents before handoff. The examples below use the npm runner; use the equivalent `@tanstack/intent@latest` runner for pnpm, Yarn, or Bun.

## Quick start

1. Run `npx @tanstack/intent@latest review` from your library repository to see pending work.
2. Ask your agent to review those items using the current source change. It updates the skills and planning record, then runs the relevant checks.
3. Keep the resulting `.intent/review-state.json` with the source, skills, and planning documents in your change.
4. Run `npx @tanstack/intent@latest review --check` to confirm that no unreviewed items remain.

A justified no-op is a completed review. Missing evidence remains pending.

## Options

### Comparison and output

| Option | Behavior |
| --- | --- |
| `[dir]` | Locate the Git working tree. The review covers that repository, including its packages. |
| `--base <ref>` | Compare against an available Git commit or ref, such as the actual PR base. |
| `--json` | Print the complete structured report for an agent or script. |
| `--check` | Exit nonzero when review items remain. |

### Recording and reminders

| Option | Behavior |
| --- | --- |
| `--record <report.json>` | Record completed outcomes from an annotated JSON report. |
| `--github-review` | Write `review-items.json`, a `pr-body.md` reminder when needed, and GitHub step output/summary when configured. |
| `--package-label <label>` | Set the library label in generated reminder items. |

`--record` cannot be combined with `--base`, `--json`, or `--check`. `--github-review` cannot be combined with `--record`, `--json`, or `--check`.

## Behavior

### What appears in a review

| Item | Why it appears | What to do |
| --- | --- | --- |
| Skill (`skill`) | No recorded review, changed source, or changed skill/reference content. | Compare the guidance with the source and update it when needed. |
| Planning records (`planning`) | The domain map, spec, or tree needs initial review, or its source/skill evidence changed. | Reconcile all three documents, preserving earlier decisions and remaining work. |
| Unmapped change (`source`) | A changed file is outside declared skill sources, or a skill was removed. | Decide whether existing guidance, a new skill, or an exclusion is appropriate. |

An unmapped file does not automatically require a new skill. A planning review can be needed even when nobody edited the planning documents.

### Comparison scope

Git and an initial commit are required. The default command is read-only.

| Setting | Comparison |
| --- | --- |
| Explicit `--base` | The commit selected by that ref. |
| Existing review state | The first recorded baseline, plus each item's recorded content hashes. |
| No review state | `HEAD` and the current working tree. |

The comparison includes committed changes since the base and staged, unstaged, and untracked files visible to Git. Renames appear as removals and additions. It reviews final working-tree content; a partially staged index is not separately certified.

Recorded hashes detect later edits even when a review happened before a commit. The state retains hashes rather than earlier source text. Default review fails closed when its stored baseline is no longer available; it does not infer a replacement from rewritten history.

### Recover an unavailable baseline

A squash merge, shallow clone, or history rewrite can remove the commit stored as the review baseline. Choose an available commit that covers the changes you intend to review, then create an explicit-base report:

```bash
npx @tanstack/intent@latest review --base <available-commit> --json > .intent/review.json
```

Review and resolve every item in that report, then record it:

```bash
npx @tanstack/intent@latest review --record .intent/review.json
```

When the previous stored baseline is unavailable, recording this fully resolved explicit-base report adopts the report's base as the new durable baseline. An empty report can also adopt the new base because it records that the selected comparison has no pending items. A partial report, an omitted or `unresolved` outcome, unresolved source or planning evidence, or a changed fingerprint cannot replace the missing baseline. When the stored baseline is still available, recording an explicit-base report does not replace it.

> [!WARNING] Select the recovery base deliberately
> The selected base sets the Git comparison boundary. Fetch missing history when possible. Otherwise choose a reachable commit old enough to include every intended change; a base that is too recent can omit earlier unreviewed changes.

### Source mappings

Discovery covers first-party `skills/**/SKILL.md` files in the repository and its packages. It excludes `node_modules`, even without a Git ignore rule.

| Source entry | Resolution |
| --- | --- |
| `src/request.ts` | Relative to the package containing `skills/`. |
| `owner/repository:src/request.ts` | Relative to the Git root; the repository identity must match the origin or root package metadata. |
| `src/**/*.ts` | Git glob syntax: `*`, `?`, character classes, and `**`. |

Brace expansion and extglobs are unsupported. Custom skill roots, ignored files, submodules, external source repositories, and symbolic links require manual review. Missing or unsupported mappings remain unresolved.

### Required planning documents

The maintainer workflow keeps a cumulative record across batches:

| Document | Records |
| --- | --- |
| `domain_map.yaml` | Domains, developer tasks, relationships, failure modes, and gaps. |
| `skill_spec.md` | Readable coverage, maintainer decisions, batch history, and remaining work. |
| `skill_tree.yaml` | Skill identities, paths, package placement, prerequisites, and source mappings. |

Review uses an existing `_artifacts/` or `skills/_artifacts/` location. Without one, installed maintainer guidance requires `_artifacts/` at a monorepo root or `skills/_artifacts/` for a standalone library. Previously recorded locations remain required if their files are deleted.

All three files must be present, nonempty, readable, and visible to Git. Each YAML document must contain an object with a `skills` array. Custom artifact locations require manual checks.

The planning snapshot includes the documents and the discovered skill/source evidence. Changes reopen planning review without reopening an otherwise unchanged individual skill. The check establishes file presence, YAML shape, and reviewed content hashes; the agent and maintainer still assess whether the written record is accurate and complete.

## Record a completed review

The installed maintainer procedure handles these steps. For manual use:

1. Review the pending items, edit guidance and planning records as needed, and run the relevant checks.
2. Regenerate the report after those edits. Save it outside source paths:

   ```bash
   mkdir -p .intent
   npx @tanstack/intent@latest review --json > .intent/review.json
   ```

3. Add an outcome, reason, and evidence to each item you completed. Preserve the report's identities, baseline, and fingerprints.
4. Record the report and check remaining work:

   ```bash
   npx @tanstack/intent@latest review --record .intent/review.json
   npx @tanstack/intent@latest review --check
   ```

### Outcomes

| Outcome | Meaning | Clears the item? |
| --- | --- | --- |
| `updated` | Guidance or planning records were corrected and checked. | Yes, with current fingerprints and resolved evidence. |
| `no-change` | The existing content was checked and remains accurate. | Yes, with a reason and evidence. |
| `out-of-scope` | A skill or source item is outside the reviewed guidance scope. | Yes, with a reason and evidence. Not accepted for planning records. |
| `unresolved` | Required evidence or a decision is still missing. | No. |
| No outcome | The item has not been reviewed. | No. |

For example, add these fields to an existing report item; this is not a complete report:

```json
{
  "outcome": "no-change",
  "reason": "Only the internal cache changed; the documented retry bound and errors remain the same.",
  "evidence": ["src/request.ts", "test/request.test.ts: passed"]
}
```

For a planning item, the reason and evidence must cover all three documents. Preserve prior tasks, decisions, and future work when extending them with a new batch.

### Saved state

`--record` writes `.intent/review-state.json` containing the baseline, source/guidance hashes, reviewed revision, outcomes, reasons, and evidence. It does not commit, publish, or change skill versions. `.intent/` is reserved for review state and working reports and is excluded from unmapped-change items.

Identical recorded content suppresses repeat reminders. Later edits reopen review. The saved state does not replace the planning documents, execute evidence strings, or verify the truth of a recorded conclusion.

## Default and JSON output

Text output shows the pending count and up to 20 items, with changed paths, unresolved problems, and the next step. Use `--json` for the full report.

| JSON field | Meaning |
| --- | --- |
| `schemaVersion` | Report format version; currently `1`. |
| `root`, `head`, `base` | Working-tree identity and compared Git revisions. |
| `items` | Pending skill, planning, and source review items. |
| Item `id`, `kind`, `path` | Stable item identity, category, and location. |
| Item `changedFiles` | Paths changed since the relevant comparison. Can be empty for initial review. |
| Item `snapshot`, `fingerprint` | Current content hashes and item fingerprint used when recording. |
| Item `problems` | Unresolved evidence that prevents recording completion. |

## Automated checks

The optional version 4 [setup workflow](./intent-setup) connects review to PRs and releases:

| Trigger | Check |
| --- | --- |
| Pull request with maintainer guidance or review state | `review --base <PR-base-sha> --check` |
| Release/manual run with review state | `review --github-review` |
| Release/manual run without review state | Existing `stale --github-review` fallback |

This catches skipped review recording and missing planning documents. It does not run an authoring model in CI. Your coding agent handles the reminder using the same maintainer procedure.

## Status and errors

| Result | Behavior or next step |
| --- | --- |
| No pending items | `--check` exits `0`. |
| Pending review | `--check` exits nonzero; review and record the remaining items. |
| Missing, empty, or invalid planning document | Restore or repair the record before recording completion. |
| Source or guidance changed after the report | Regenerate `--json` after editing; stale fingerprints are rejected. |
| Missing recorded baseline | Fetch the referenced history, or create and fully resolve an explicit `--base` report to adopt a deliberate available baseline. |
| Missing or option-like explicit base | Pass a reachable commit or ref; explicit bases remain strict and are never inferred. |
| Corrupt review state | Restore or repair the state; Intent does not silently discard it. |
| Existing recording lock | Wait for the current recording. Remove the reported `.intent/review-state.json.lock` only after confirming no recording is running, then regenerate the report and retry. |
| Wrong working tree | Regenerate the report in the repository being reviewed. |
| Git/setup failure | Normal review exits nonzero. `--github-review` writes a failure reminder so the missing evidence stays visible. |

## Related

- [Maintainer quick start](../getting-started/quick-start-maintainers)
- [intent install](./intent-install)
- [intent validate](./intent-validate)
- [intent stale](./intent-stale)
