---
name: generate-skill
description: >
  Use when creating or extending library skill batches, updating guidance after library source or docs change, or acting on an Intent review report, including when the maintainer asks only for the library change. For full-library discovery or taxonomy design, use domain-discovery; for generating an approved full-library tree, use tree-generator.
metadata:
  purpose: >
    Author and maintain library skills when creating an initial skill batch, changing library source or docs, or acting on an Intent review report. Use the current task and source evidence to create useful guidance, verify it on representative tasks, and update affected skills.
  version: '1.1'
  category: meta-tooling
  input_artifacts: 'developer task, source documentation, supplied diff, review report, or existing skill tree entry'
  output_artifacts: 'skills and references, domain_map.yaml, skill_spec.md, skill_tree.yaml, executable task checks, and revision-bound review outcomes'
---

# Author and maintain library skills

Work in the maintainer's library repository with their existing coding agent. Produce a source-grounded skill batch or focused update with task checks, a cumulative planning record, and a compact review. Intent supplies the procedure and deterministic evidence; your agent performs the authoring work.

Use [Agent Skills](https://agentskills.io/home) as the shared format and authoring guidance. The rules below apply its [best practices](https://agentskills.io/skill-creation/best-practices) to library maintenance; Intent adds source mappings, planning records, and revision-bound review.

## 1. Recover the task and choose the workflow

Use the current conversation, supplied diff, identified code/docs change, review report, or selected skill tree entry. Reuse the task, decisions, and evidence already established in this session; do not ask the maintainer to paste them again. Identify what developers need help doing and which package owns that task. If there is no usable task or review input, ask one question: “What do developers need help doing with this library?” Wait for the answer.

Check repository instructions and Git status before edits; preserve unrelated changes. Discover the package name, version, repository, skill root, and vocabulary from the repository. Use an established custom root; otherwise use `skills/` inside the owning package, including in monorepos.

For an initial skill set or a request spanning several developer tasks, read [initial batches](references/initial-batches.md). Reuse scope already approved in the conversation. For one concrete task, proceed directly below. During ordinary library work, keep the code change as the primary task. Read [source review](references/source-review.md) to identify affected guidance from actual changes and record completed reviews before handing off any of these workflows.

For every authoring batch or update, read [the planning record procedure](references/planning-records.md) and create or incrementally maintain `domain_map.yaml`, `skill_spec.md`, and `skill_tree.yaml`. Read existing records first and preserve prior scope and decisions. These records grow with the batches; maintaining them does not require a full-library interview or generating every planned skill.

When the input is an `intent stale` report or generated review PR, read [review-signals](references/review-signals.md) before deciding what to edit. Investigate the supplied items in the requested scope, applying this procedure to each affected task. A review signal alone is not a task or proof of changed guidance; first use the reference to establish its meaning.

## 2. Read the evidence and choose the owner

Read the relevant source, types, tests, docs, examples, and existing skills with their required references. Follow imports or related guidance where they affect the task. Record the source revision or package version used. For an update, inspect the supplied change and the existing skill's claims; use an actual diff or documented before/after behavior when available. A version change alone does not establish changed behavior or a baseline.

Prefer updating guidance that already owns the task. Create one new skill only when developers would benefit from discovering that task independently. Clarify an ambiguous boundary with a concrete example: would a developer trying this task need the same guidance, or a different prerequisite or workflow? Keep the library's established names and terminology.

Expand research only to close a task-relevant gap. Read the relevant FAQ, migration guide, or issue/discussion when local evidence does not explain a failure or intended behavior. Verify external evidence against the target version. Do not scan broad issue histories or regenerate the library for a routine update.

Before editing, identify the existing sections affected or the independently useful task that justifies a new file. If the inspected change leaves all relevant guidance accurate, report the evidence and make no content rewrite or artificial version bump. Missing or conflicting evidence is uncertainty, not “no impact”; state what is missing and which conclusion it blocks.

## 3. Resolve consequential unknowns

Look up discoverable facts yourself. Ask only for unresolved maintainer decisions that change the task boundary, intended behavior, or recommended pattern. Ask dependent questions after their prerequisites are settled. Use the concrete scenario and evidence behind the question, then wait for the answer before writing the dependent guidance. Continue independent work where possible. If evidence remains unavailable, report the affected work as blocked or partially verified rather than inventing an answer.

No fixed interview or review-preference question is needed for one task.

## 4. Write the bounded change

Apply the writing rules below to each task in the agreed batch. For a **new skill**, read [the skill format](references/skill-format.md) for frontmatter, body, and prerequisite conventions. Source documentation can establish the batch’s evidence; create or extend its required planning record alongside the skills.

For an **update**, preserve established names, layout, terminology, and scope unless the actual change requires otherwise. Edit only affected sections and references. Add a sourced old/new example when a changed pattern would otherwise mislead users. Reconcile all three planning documents with the change using the planning record procedure; update affected entries and preserve accurate, unrelated decisions. Change `metadata.library_version` only when the revised guidance is verified for that version; do not fabricate historical versions or rewrite unrelated metadata to clear a staleness signal.

### Writing rules

- Write `description` as self-contained “Use when…” activation guidance: concrete developer tasks, library/framework context, and relevant boundaries. Include requests that omit API names. Other agents must be able to select the skill from this standard field alone; exact wording is not a validation rule.
- Put the descriptive explanation of what the skill is for in `metadata.purpose`. For an existing skill without that field, copy its pre-edit description text unchanged before writing the activation description. Preserve an existing purpose; never replace it with a later activation description. Read [the field contract](references/skill-format.md#purpose-and-activation) before this migration or when creating either field.
- Start the body with the task procedure. Keep skill-selection criteria in `description`; retain execution prerequisites, conditional reference pointers, and downstream handoffs in the body.
- Each independent skill enables an independently useful developer task. Keep common, necessary guidance accessible from its entry point.
- Put conditional detail behind a Markdown link that says **when to read it**. Choose reference boundaries by relevance, not proximity to 500 lines.
- Group features used in the same developer task under one skill. Use references for conditional detail within that task; create a separate skill only for a task worth discovering independently. API exports and feature counts do not determine skill boundaries.
- Give shared rules one authoritative home. Every affected entry point must route to that home with the required reading condition; preserve genuine prerequisites and failure handling when removing duplication.
- Use source, types, and docs for readily discoverable facts. Capture the decisions, constraints, and pitfalls they do not make obvious. Include the API detail necessary to make the task's examples usable.
- Keep necessary, complete examples with real imports and concrete values. Ground pitfalls in evidence; do not manufacture mistakes to meet a quota.
- State observable completion and failure conditions for the developer's task. A shorter file that omits required behavior is not an improvement.
- Give one supported default, with alternatives only for a concrete condition. Specify exact steps for fragile operations and allow judgment where approaches are equivalent. Keep non-obvious failure constraints at the entry point when the agent could miss a conditional reference.
- When adding commands or reusable automation, follow [script guidance](references/skill-format.md#commands-and-bundled-scripts). Bundle tested logic only when it prevents repeated reinvention or fragile command construction.

## 5. Verify the developer task and hand off

For new guidance and updates that change a recommended behavior, follow [task quality checks](references/task-quality.md). Create or reuse a representative task and executable checks in the repository's existing test setup. A successful structural check is not evidence that a consumer can complete the task.

For new or changed descriptions, also follow [discovery checks](references/task-quality.md#check-discovery-separately). Keep activation evidence separate from task correctness.

Run `npx @tanstack/intent@latest validate <skills-root>` with the actual owning package's skill directory (or the repository's installed `intent`). Fix errors without weakening validation. Keep every SKILL.md within the 500-line limit. Review packaging warnings separately; they do not require installing dependencies or changing publishing configuration during authoring.

Check that every reference and prerequisite resolves, every changed claim matches the cited source/version, and examples use actual supported APIs. Exercise the relevant example or package check where available. Intent's structural validation does not prove semantic correctness or agent behavior. If a check cannot run, report it as not verified with the reason.

Inspect the actual `SKILL.md` output and matching tree entry before handoff: the description makes the use conditions clear, purpose explains the skill, and both stay within supported behavior. Check migrated purpose text against the pre-edit description and preserve established purpose on later updates. Do not imply stronger guarantees to attract more requests. Check that references have reading conditions and independently discoverable tasks justify any new skills.

Verify all three planning documents against the resulting skills and prior record, then record completed skill and planning outcomes using the [source review procedure](references/source-review.md), then inspect the final diff for unrelated edits and run `git diff --check` for touched files. Return the changed library behavior, affected skill/reference paths, all three planning document paths and their changes or justified no-op, source/version evidence, structural and task-check results, and any remaining maintainer decision. Distinguish updated guidance, verified no change, and missing evidence for each reviewed task. Report whether a fresh consumer session completed the representative task; if that check could not run, mark it unverified rather than treating the authoring session as independent evidence. The result is ready for maintainer review when the task is usable end to end and those checks pass.

Track the handoff gates explicitly: skills and task checks verified; all three planning documents reconciled; review outcomes recorded; `review --check` run and any pending work reported. Do not finish after writing the files while leaving these gates unchecked.

Stop at the reviewable diff. Commits, labels, workflow/dependency installation, and publishing are separate actions requiring the maintainer's request.
