---
name: generate-skill
description: >
  Create one skill for a concrete developer task, or update existing
  guidance after a supplied code or documentation change. Also use when
  acting on an Intent review report or writing a selected entry from an
  existing skill tree.
metadata:
  version: '1.1'
  category: meta-tooling
  input_artifacts: 'developer task, source documentation, supplied diff, review report, or existing skill tree entry'
  output_artifacts: 'SKILL.md and necessary references, or an evidence-backed no-op'
---

# Create or update one skill

Work in the maintainer's library repository with their existing coding
agent. Produce a bounded, source-grounded change and validation results
for review. Intent prints these instructions; it does not generate content
or detect which skills a code change affects.

## 1. Recover the task

Use the current conversation, supplied diff, identified code/docs change,
review report, or selected skill tree entry. Reuse the task, decisions,
and evidence already established in this session; do not ask the maintainer
to paste them again. Identify what developers need help doing and which
package owns that task. If there is no usable task or review input, ask one question:
“What do developers need help doing with this library?” Wait for the answer.

Check repository instructions and Git status before edits; preserve
unrelated changes. Discover the package name, version, repository, skill
root, and vocabulary from the repository. Use an established custom root;
otherwise use `skills/` inside the owning package, including in monorepos.

A focused task requires no new domain map, skill tree, glossary, or ADR.
Reuse relevant decisions in existing artifacts. Their presence does not
turn a one-skill request into a full-library exercise. For an explicitly
requested full-library design, start with
[domain-discovery](../domain-discovery/SKILL.md), then
[tree-generator](../tree-generator/SKILL.md).

When the input is an `intent stale` report or generated review PR, read
[review-signals](references/review-signals.md) before deciding what to edit.
Investigate the supplied items in the requested scope, applying this
procedure to each affected task. A review signal alone is not a task or
proof of changed guidance; first use the reference to establish its meaning.

## 2. Read the evidence and choose the owner

Read the relevant source, types, tests, docs, examples, and existing skills
with their required references. Follow imports or related guidance where
they affect the task. Record the source revision or package version used.
For an update, inspect the supplied change and the existing skill's claims;
use an actual diff or documented before/after behavior when available.
A version change alone does not establish changed behavior or a baseline.

Prefer updating guidance that already owns the task. Create one new skill
only when developers would benefit from discovering that task independently.
Clarify an ambiguous boundary with a concrete example: would a developer
trying this task need the same guidance, or a different prerequisite or
workflow? Keep the library's established names and terminology.

Expand research only to close a task-relevant gap. Read the relevant FAQ,
migration guide, or issue/discussion when local evidence does not explain
a failure or intended behavior. Verify external evidence against the target
version. Do not scan broad issue histories or regenerate the library for a
routine update.

Before editing, identify the existing sections affected or the independently
useful task that justifies a new file. If the inspected change leaves all
relevant guidance accurate, report the evidence and make no content rewrite
or artificial version bump. Missing or conflicting evidence is uncertainty,
not “no impact”; state what is missing and which conclusion it blocks.

## 3. Resolve consequential unknowns

Look up discoverable facts yourself. Ask only for unresolved maintainer
decisions that change the task boundary, intended behavior, or recommended
pattern. Ask dependent questions after their prerequisites are settled.
Use the concrete scenario and evidence behind the question, then wait for
the answer before writing the dependent guidance. Continue independent
work where possible. If evidence remains unavailable, report the affected
work as blocked or partially verified rather than inventing an answer.

No fixed interview or review-preference question is needed for one task.
An exhaustive design interview belongs to explicitly requested discovery.

## 4. Write the bounded change

Apply the writing rules below. For a **new skill**, read
[the skill format](references/skill-format.md) for frontmatter, body, and
prerequisite conventions. Source documentation alone is sufficient input
when it supports the task; planning artifacts are optional.

For an **update**, preserve established names, layout, terminology, and
scope unless the actual change requires otherwise. Edit only affected
sections and references. Add a sourced old/new example when a changed
pattern would otherwise mislead users. Update an existing artifact only
if leaving it untouched would create a material contradiction. Change
`metadata.library_version` only when the revised guidance is verified for
that version; do not fabricate historical versions or rewrite unrelated
metadata to clear a staleness signal.

### Writing rules

- Descriptions name distinct conditions for loading a skill. Include API
  names when they distinguish the task, not an inventory of every export.
- Each independent skill enables an independently useful developer task.
  Keep common, necessary guidance accessible from its entry point.
- Put conditional detail behind a Markdown link that says **when to read
  it**. Choose reference boundaries by relevance, not proximity to 500 lines.
- Give shared rules one authoritative home. Every affected entry point must
  route to that home with the required reading condition; preserve genuine
  prerequisites and failure handling when removing duplication.
- Use source, types, and docs for readily discoverable facts. Capture the
  decisions, constraints, and pitfalls they do not make obvious. Include
  the API detail necessary to make the task's examples usable.
- Keep necessary, complete examples with real imports and concrete values.
  Ground pitfalls in evidence; do not manufacture mistakes to meet a quota.
- State observable completion and failure conditions for the developer's
  task. A shorter file that omits required behavior is not an improvement.

## 5. Validate and hand off

Run `npx @tanstack/intent@latest validate <skills-root>` with the actual
owning package's skill directory (or the repository's installed `intent`).
Fix errors without weakening validation. Keep every SKILL.md within the
500-line limit. Review packaging warnings separately; they do not require
installing dependencies or changing publishing configuration during authoring.

Check that every reference and prerequisite resolves, every changed claim
matches the cited source/version, and examples use actual supported APIs.
Exercise the relevant example or package check where available. Intent's
structural validation does not prove semantic correctness or agent behavior.
If a check cannot run, report it as not verified with the reason.

Inspect the final diff for unrelated edits and run `git diff --check` for
touched files. Return the skill/reference paths, why each changed (or why
no change was needed), source/version evidence, validation and example-check
results, and remaining uncertainty. The result is ready for maintainer review
when the task is usable end to end and those checks pass.

Stop at the reviewable diff. Commits, labels, workflow/dependency installation,
and publishing are separate actions requiring the maintainer's request.
