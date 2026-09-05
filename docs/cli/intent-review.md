---
title: intent review
id: intent-review
---

Review first-party skills against actual Git source changes and record completed reviews so identical content does not generate repeated reminders.

```bash
intent review [dir] [--base <ref>] [--json] [--check]
intent review [dir] --record <report.json>
intent review [dir] --github-review [--package-label <label>]
```

`dir` locates the Git working tree; the review covers that repository, including its packages. Git and an initial commit are required. The default command is read-only.

## What it reports

- A skill with no recorded review, changed source contents, or changed guidance/references.
- Changed files outside the declared source mappings, including newly added areas and removed skills. These are investigation inputs, not proof that a new skill is needed.
- Unknown evidence: missing or unsupported source mappings, foreign repositories, symbolic links, unavailable history, or Git conflicts. Unknown evidence is never treated as no impact.

Discovery covers `skills/**/SKILL.md` inside the repository and its packages. Plain `sources` paths are package-relative. `owner/repository:path` paths are repository-relative and must match the origin or root package repository metadata. Source patterns use Git's glob syntax: `*`, `?`, character classes, and `**`. Brace expansion and extglobs are unsupported. Custom skill roots, ignored files, submodules and external source repositories need manual review.

The comparison includes committed changes since the base plus staged, unstaged, and untracked files visible to Git. Renames appear as removed and added paths. `--base` selects an available commit explicitly; otherwise the command uses the first recorded baseline or `HEAD`. The referenced history must remain available. Each recorded skill also has content hashes, so another edit reopens review even when the previous review happened before a commit. Earlier uncommitted source text is not retained.

Human output lists up to 20 items. `--json` returns the full versioned report with item identities, changed paths, current snapshots, fingerprints, and problems. `--check` returns a nonzero exit code when items remain. Git/setup failures also exit nonzero.

## Record a completed review

The installed maintainer procedure does this in the coding-agent workflow. For manual use, save `--json` output outside source paths, such as `.intent/review.json` after creating `.intent/`. After editing skills and running checks, regenerate the report and annotate the selected items:

```json
{
  "outcome": "no-change",
  "reason": "Only the internal cache changed; the documented retry bound and errors remain the same.",
  "evidence": ["src/request.ts", "test/request.test.ts: passed"]
}
```

These fields are added to each existing report item; preserve the report identity and fingerprints. Supported outcomes are `updated`, `no-change`, `out-of-scope`, and `unresolved`. Every completed outcome requires a reason and evidence. Unresolved or unannotated items remain pending. Stale fingerprints and unresolved source mappings cannot be recorded as complete.

`--record` writes `.intent/review-state.json` with source/guidance hashes, the compared baseline, reviewed revision, outcome, reason, and evidence. Keep that file with the reviewed change. It does not commit, publish, change skill versions, or verify the truth of the supplied semantic conclusion. Identical recorded content suppresses reminders; another edit reopens the item. Corrupt state fails explicitly instead of discarding earlier decisions.

The `.intent/` directory is reserved for review state and working reports and is excluded from unmapped-change items. The command excludes `node_modules` even without a Git ignore rule, and does not read ignored files or follow symbolic links for source evidence. It reviews final working-tree content; a partially staged index is not a separately certified snapshot.

## Release fallback

`--github-review` writes the existing `review-items.json` and `pr-body.md` reminder artifacts plus GitHub step output/summary when configured. A failed comparison writes a failure reminder so missing evidence remains visible. The generated version 4 workflow selects this mode when recorded state exists, and uses `intent stale --github-review` otherwise.

The version 4 template also runs `review --base <PR-base-sha> --check` on every PR once maintainer guidance or review state exists. This catches unrecorded source changes when an agent skips the maintenance procedure. It checks coverage and fingerprints; it does not certify semantic conclusions or execute the evidence strings in review state.

No authoring model runs in CI. Your existing coding agent performs updates when you review the reminder. See [Quick Start for Maintainers](../getting-started/quick-start-maintainers) and [setup commands](./intent-setup).
