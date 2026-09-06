# Maintain the library planning record

Read this before creating a skill batch, updating existing guidance, or completing a source review. Every authoring batch creates or incrementally maintains all three planning documents: `domain_map.yaml`, `skill_spec.md`, and `skill_tree.yaml`. They are the cumulative record of the library’s domains, developer tasks, maintainer decisions, coverage, and remaining work. `.intent/review-state.json` records review evidence; it does not replace these documents.

## Locate and read the existing record

Read all three existing documents before proposing or editing the batch. Preserve established names, domains, package ownership, recommendations, exclusions, future work, and unresolved questions. The current batch extends the record; it never replaces the record with only the tasks in this conversation.

Use the established artifact location. Without an existing location, use `skills/_artifacts/` for a standalone package and `_artifacts/` at the repository root for a monorepo. A monorepo has one shared record covering its packages, with skill files in their owning packages. Keep an established custom skills root; its artifact location replaces `skills/_artifacts/`. Do not create a second record because the current task runs in another package. If multiple records disagree, preserve them and resolve their ownership before merging or deleting anything.

If one or more documents are missing, reconstruct the missing documents from the surviving record, existing skills, source evidence, and confirmed maintainer decisions. Preserve the surviving documents. For the first batch in a repository without skills or artifacts, create all three from the agreed tasks and their supporting evidence. Record the assessed scope and unknown areas explicitly; a first batch is not evidence of complete library coverage.

## Use the existing formats

Read [the domain map and skill spec formats](../../domain-discovery/references/artifacts.md) for those two documents and [the skill tree format](../../tree-generator/SKILL.md#scaffold-flow-output) for the third. Use the formats without entering full-library discovery or its interviews. The batch’s existing source research supplies discoverable facts; ask only for unresolved maintainer decisions.

- `domain_map.yaml` owns the domain/task relationships, supported failure modes, cross-references, tensions, and knowledge gaps. Keep task slugs and package ownership aligned with the skills.
- `skill_spec.md` is the human-readable coverage and decision record. Retain the existing inventories and add a **Coverage and batch history** section recording the assessed scope, each completed batch or behavior change, its source revision/version, consequential decisions and reasons, check outcomes, and remaining work. Keep entries concise; do not store transcripts. Distinguish implemented guidance from planned work and unassessed areas.
- `skill_tree.yaml` owns skill identities, paths, prerequisites, source mappings, and package placement. Keep existing planned entries and their status or explanatory notes. Add each new skill, and update entries when their names, paths, dependencies, or sources change. Resolve `path` relative to the owning package when `package` is present; otherwise resolve it relative to the library root. Keep `generated_from` links accurate for the actual artifact location.

Keep each tree entry's `description` aligned with its skill's activation description and its `purpose` aligned with `metadata.purpose`. Existing map/spec task explanations retain their meaning; do not replace them with trigger text. Record a purpose migration and its preserved source text in the batch review without discarding prior decisions.

Use meaningful values from evidence. An empty inventory or generic sentence is not a completed planning record when the batch has authored skills. Preserve fields or sections outside the batch. Update dates and version claims only when the associated content or verified scope changes.

## Extend the record with the batch

Before authoring, reconcile the selected tasks with the existing inventory. Reuse the owning skill and domain where appropriate. Record newly agreed scope and decisions without inventing a complete taxonomy for unassessed areas. Then write the skills and their task checks.

Before handoff, reconcile the resulting diff with all three documents:

1. Every new or changed skill has consistent identity, task coverage, sources, prerequisites, and package/path placement in the record. Update failure modes, examples of recommended behavior, tensions, and links where the change affects them.
2. Previously recorded tasks, decisions, exclusions, and future work remain present unless source evidence or an explicit maintainer decision supersedes them. Preserve the reason for a superseded decision in the spec. A new batch never silently shrinks the library’s recorded scope.
3. A renamed or removed skill has no stale active path or dependency in the map, spec, or tree. Retain the retirement or replacement reason in the spec. Do not remove planned future work just to make the current batch look complete.
4. Newly exposed uncertainty is recorded as a gap or remaining work, with its consequence. A source change that leaves the records accurate can receive an evidence-backed no-op; do not rewrite accurate documents or add a history entry for a no-op.

## Check and record completion

Check that all three files exist and contain substantive content. Parse both YAML files with the repository’s available YAML parser, then compare the map, spec, tree, and actual skill files. Verify every implemented tree path and prerequisite, the selected batch’s coverage, and preservation of prior entries. Planned future entries are not passing implementations. Run skill validation and the task-quality checks for changed guidance.

Follow [source review](source-review.md) after all skill and record edits. The default installed maintainer workflow reports a planning review item whose snapshot includes the three documents and the skill/source evidence. It stays unresolved when a required file is missing, empty, ignored, or invalid; later source or skill changes reopen its review even if the documents did not change. Record an `updated` outcome after changing the record or a `no-change` outcome with evidence covering all three documents when they remain accurate.

The CLI checks record presence, YAML shape, and review fingerprints. It does not prove that the inventories, decisions, or written claims are correct. For custom artifact locations outside the review command’s supported roots, perform and report the same record checks manually instead of claiming automatic coverage.

Return the skills, task checks, and all three planning documents in the same review. Report missing records, inconsistent coverage, or unresolved decisions explicitly; do not present the batch as complete while its planning record is incomplete.
