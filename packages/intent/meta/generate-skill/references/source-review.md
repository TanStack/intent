# Review changes and remember the result

Read this before handing off an initial skill batch, an ordinary library change, or an Intent review reminder. The CLI identifies candidate guidance, the shared planning record, and unmapped changes from local Git evidence. It does not infer semantic impact or write skill content.

## Inspect the current changes

Run `intent review --json` using the repository's installed Intent command, or the package-manager command used to load this procedure. When the task supplies a PR base, pass `--base <ref>` with that actual revision. Do not invent a historical baseline. Without an explicit base, Intent compares against the first recorded review's baseline, or `HEAD` when no state exists. It also compares each skill's current source and guidance content with its last recorded review.

If rewritten history makes the recorded baseline unavailable, do not guess a replacement. Fetch the missing history, or choose an available commit as a new coverage boundary from repository evidence. Generate the report with `intent review --base <commit> --json`, resolve every reported item, then record that report. A fully resolved explicit report adopts its base for later default reviews, including when the report has no items. An omitted, unresolved, or invalid item leaves the unavailable baseline unchanged.

For a new batch, review the selected skills. Other items remain pending unless the maintainer has included them in the task. For ordinary code changes, inspect affected skills and unmapped changes within the agreed change. An unmapped file is an investigation input, not a demand for a new skill or full taxonomy. Decide from the source and developer task whether existing guidance needs updating, a new independently useful skill is warranted, or no guidance change is needed.

Read [the planning record procedure](planning-records.md), then review the actual diff, affected source, skill, references, relevant tests, and all three planning documents. Create missing records and reconcile changed coverage, recommendations, dependencies, and maintainer decisions before handoff. Preserve unrelated record entries and future work. `changedFiles` can be empty for an initial review. A recorded content snapshot detects edits even if the earlier review happened before a commit; it does not retain the earlier source text. Use an available Git diff or explain when historical text is unavailable. Missing sources, foreign repositories, conflicts, or unavailable history remain unknown until the evidence is resolved.

Plain `sources` paths are relative to the package containing `skills/`. `owner/repository:path` paths are relative to the Git root and must match the local repository's origin or root package repository metadata. Git glob syntax supports `*`, `?`, character classes and `**`; brace expansion and extglobs are unsupported. Keep evidence paths accurate. Custom skill roots, ignored source files, and external repositories require explicit manual review; this command discovers first-party `skills/**/SKILL.md` files visible to Git.

## Record only completed reviews

After guidance edits and task checks, regenerate the JSON report. Save it outside tracked source paths, such as `.intent/review.json` after creating `.intent/`, so it cannot become its own review input. Include the `planning` item when the batch changes source or guidance, even when all three documents remain accurate. Annotate the selected items with:

- `outcome`: `updated`, `no-change`, `out-of-scope`, or `unresolved`.
- `reason`: the concrete behavior comparison and why that outcome follows.
- `evidence`: source paths/revisions and actual check results. For behavior-changing guidance, include structural validation, executable task checks, and fresh-consumer evidence or its explicit limitation.

Preserve the report's identity, base and fingerprints. Run `intent review --record .intent/review.json`. For planning items, use `updated` or an evidence-backed `no-change` covering all three documents. The command rejects stale fingerprints and unresolved source mappings or planning files. It writes completed outcomes to `.intent/review-state.json`; unresolved or unannotated items stay pending. Do not invent passing checks, use a generic reason, or mark unrelated items complete just to empty the report.

Keep the state file with the source/skill change for maintainer review. It contains content hashes, revisions, outcomes and evidence, not source contents. Record operations do not commit or publish. An identical content snapshot suppresses repeated reminders, including a justified no-op; another source or guidance change reopens review. This records an evidence-backed decision, not independent proof that the decision is correct.

Run `intent review` once more and include any remaining in-scope items in the handoff. A missing Git history, unsupported source mapping or unavailable fresh-consumer check must be visible to the maintainer. The optional generated workflow checks for unreviewed source changes on every PR once maintainer guidance or review state is present, even if an agent omitted this procedure. On releases it runs the same revision-aware check, with the legacy staleness/coverage check retained for repositories that have not adopted recorded reviews. The check enforces recorded coverage; it does not run or certify the agent's semantic review.
