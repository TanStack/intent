# Focused authoring and review walkthrough

Manual walkthrough on 2026-09-04 (America/Vancouver), performed by the implementing agent. This is not a live evaluation with an independent agent or a claim that other agents will follow the instructions reliably.

This historical walkthrough predates the cumulative planning-record requirement. The current maintainer authoring workflow creates and maintains all three planning documents; standalone structural validation still accepts manually authored skills without maintainer setup.

## Source and inputs

- Source: TanStack/intent at `bffcdabbdb9a55af5a3ba1ff09ece0f7da223eb2`, `@tanstack/intent@0.4.0`, with this PR's authoring guidance.
- Temporary workspace: `/private/tmp/intent-authoring-walkthrough-P2DfQu`. Source copies, builds, probes, authored output, and logs stayed there.
- Task: “Help maintainers validate a manually authored local skill and fix structural errors without setting up a publishing workflow.”
- Evidence read: `packages/intent/package.json`, `src/commands/validate.ts`, its CLI registration, `src/core/project-context.ts`, validation tests in `tests/cli.test.ts`, and `docs/cli/intent-validate.md`. Paths under `src/` and `tests/` here are relative to `packages/intent/`.
- Existing meta-skills own authoring, discovery, or staleness; none owns this consumer task of running structural validation. The isolated package had no existing `skills/` guidance. One independent skill was justified.

The loaded authoring context was the actual `scaffold` stdout, `meta generate-skill` stdout, and the linked `meta/generate-skill/references/skill-format.md`. No discovery or tree references were loaded for authoring. The simple verification task did not need the optional detailed checklist template. Updates reused the procedure, existing skill, and relevant source/docs diff; no format reload was needed. This inventories the context used, not model tokens or cache savings.

## Create

Built the isolated source copy with the package's existing tsdown command. Created only `skills/validate-local-skills/SKILL.md`; no references or planning artifacts were necessary. Questions asked: **0**. Source settled the command, validation behavior, and terminology.

Complete authored output:

````markdown
---
name: validate-local-skills
description: Validate manually authored Intent skills and diagnose structural errors before review.
metadata:
  type: core
  library: '@tanstack/intent'
  library_version: '0.4.0'
sources:
  - 'TanStack/intent:packages/intent/src/commands/validate.ts'
  - 'TanStack/intent:docs/cli/intent-validate.md'
---

# Validate local skills

## Run validation

From the package that owns `skills/`, use the installed Intent CLI:

```bash
intent validate skills
```

Pass the actual custom root or package path when it differs. An explicit
missing directory or a directory with no SKILL.md files is an error; the
implicit default may skip validation when no skills directory is found.

## Fix structural errors

Use the file-specific diagnostics to correct YAML, the leaf `name` matching
its directory, and `description` (at most 1024 characters). Put Intent scalars
under `metadata` as strings. Keep SKILL.md within 500 lines; preserve the task's
necessary constraints and examples when splitting conditional references.

For a framework skill, `requires` must be an array. Preserve real prerequisites.
If `_artifacts` exists in a standalone skills root, its domain map, skill spec,
and skill tree must be present and non-empty, and YAML must parse. A focused
skill does not need a new `_artifacts` directory.

Validation is read-only by default. Apply `--fix` only when the requested work
includes its listed frontmatter migrations, then review the resulting diff.
Do not change version metadata merely to resolve unrelated validation errors.

Source: `packages/intent/src/commands/validate.ts`.

## Complete the review

An exit code of 0 plus a validated-file count confirms structural success.
Packaging warnings are informational and can be handled when preparing to
publish. Exercise examples and check reference targets separately: structural
validation alone does not establish semantic correctness.
````

Ran `node dist/cli.mjs validate skills` from the isolated package:

```text
✅ Validated 1 skill files — all passed
```

The four packaging warnings concerned the devDependency, keyword, skills shipping entry, and artifact exclusion. They remained informational; no package setup, dependency installation, or publishing action was taken. The `intent validate skills` example was exercised through that built CLI.

## Concrete behavior update

In the temporary copy only, changed the description limit in `src/commands/validate.ts` and the corresponding validation docs from 1024 to 512 characters. Changed the temporary package version to `0.4.0-walkthrough.1` to identify this local experiment. This is not a real or proposed Intent release or a change to this PR's validator.

Source change:

```diff
- if (typeof fm.description === 'string' && fm.description.length > 1024) {
+ if (typeof fm.description === 'string' && fm.description.length > 512) {
- message: `Description exceeds 1024 character limit (${fm.description.length} chars)`,
+ message: `Description exceeds 512 character limit (${fm.description.length} chars)`,
```

A probe with a 700-character description passed before the source change. After rebuilding, the same probe exited with 1:

```text
probe/length/SKILL.md: Description exceeds 512 character limit (700 chars)
```

Read the changed source/docs and existing skill. Preserved the skill's name, layout, scope, source list, and other guidance. The complete content diff was:

```diff
-  library_version: '0.4.0'
+  library_version: '0.4.0-walkthrough.1'
-its directory, and `description` (at most 1024 characters). Put Intent scalars
+its directory, and `description` (at most 512 characters). Put Intent scalars
```

The version follows an actual locally verified target; no historical baseline was inferred. Re-ran `node dist/cli.mjs validate skills`: one skill passed. Questions asked: **0**. No new references or artifacts.

## Unrelated change and no-op

Changed only the temporary `src/commands/scaffold.ts` opening prompt:

```diff
-You are helping a library maintainer create or update Intent skills.
+You are helping a library maintainer create or update Intent skills in this local walkthrough.
```

The inspected diff does not change the validator, validation docs, or any claim in the authored skill. The skill and its version remained byte-for-byte unchanged. SHA-256 before and after:

```text
ee0996f6dc3be4bc452b19833d28eb3227797c4c4b32bee7e77c0930da9347f1
```

Questions asked: **0**. The no-op follows the actual diff and task scope, not the filename alone.

## Insufficient evidence

Test input: “Update the skill for next-release support for slashes in names,” with no target source diff or release evidence. Current source still rejects slashes; a `name: library/nested` probe exited with 1 and the diagnostic `must be a single leaf segment`.

The manual response was:

> Unknown: the claimed next-release support for slashes in `name`. Current source and the executed validator reject `library/nested`. No target diff or release evidence was supplied. Leave the verified leaf-name guidance unchanged; the requested future update is blocked, not a no-impact result.

No question was sent to a real maintainer during this synthetic case. If further lookup cannot identify the target, the one needed question is: “Which source change or release should this guidance target?” Dependent edits wait for that evidence; a version change alone would not answer it.

## Existing review report and conversation context

Extended this walkthrough after connecting `stale` text output and generated review PR prompts to the focused procedure. The maintainer task, original skill, validator source diff, and previous probe results were already in this conversation; they were reused without asking for them again.

In a separate `review-library/` copy of the temporary library, restored the original 1024-character skill and set the local package version to `0.4.1`. The source and built validator still used the experimental 512-character limit from the behavior-update case. This is a local fixture, not a proposed Intent version or validator change.

Ran the current PR's built CLI against that package:

```text
@tanstack/intent (0.4.0 → 0.4.1) [patch drift]
  ⚠ validate-local-skills: version drift (0.4.0 → 0.4.1)

Next: ask your coding agent to run `npx @tanstack/intent@latest meta generate-skill` and follow it with this report and the relevant code/docs change.
```

Also ran `stale --github-review`. It wrote a `stale-skill` item for `validate-local-skills` and a PR body whose Agent Prompt loads `meta generate-skill`. Read that command's actual output and its conditional `review-signals.md` reference using the current build. No registry download or remote PR was needed.

The report established a candidate; the already supplied source diff and 700-character probe established the content change. Applied the focused procedure to the existing skill. The complete content change remained two lines: `1024` to `512`, and the locally verified `library_version` from `0.4.0` to `0.4.1`. The temporary validator passed the resulting skill and rejected the 700-character probe with the expected limit diagnostic. Disposition: **updated**, with source and validation evidence. Questions asked: **0**. No planning artifacts were created.

Then changed only the local package version to `0.4.2`. Source, docs, and examples remained identical to the just-verified snapshot. The report still flagged drift, but no guidance needed to change. Disposition: **verified no change**; kept skill content and `library_version` unchanged. Questions asked: **0**. SHA-256 before and after that no-op:

```text
c81f022f115562485ff3b3b2a98c048aeb670883e09784b20d55446a23627b16
```

`evidence/review/` retains the report, generated PR body, loaded procedure, source-based skill diff, validation, probe, subsequent version-only diff, no-op report, and item dispositions. Reference review also confirmed that failed checks require logs and workflow advisories do not justify skill rewrites. Those two cases were not independent live-agent executions.

## Checks and retained evidence

- Creation and updated output both passed the existing validator.
- Both authored files had no whitespace diagnostics from `git diff --no-index --check`; the no-index comparison reports file differences with exit code 1.
- `evidence/` in the temporary workspace contains entry prompts, both authored versions, the source baseline, builds, probe output, validation logs, update diff, no-op hash, and missing-evidence response.
- The PR's automated tests check stdout-only scaffold behavior, public meta commands, all shipped meta files, nested reference targets from an extracted package and unrelated caller, representative authored output, and an actual packed CLI report-to-procedure path with unchanged skill bytes. These checks do not evaluate agent decisions.
- Expanded-batch repository `test:ci` passed: 684 unit tests and 87 integration tests, plus TypeScript, ESLint, build, documentation links, Sherif, and Knip. ESLint reported eight existing `require-await` warnings. Localhost permission and a temporary npm cache were needed for integration tests. Installed tools were reused; pnpm's automatic dependency refresh was disabled for the run.

## Source adaptation and semantic review

[Issue #238](https://github.com/TanStack/intent/issues/238) requests a short path while retaining the full-library process. The upstream ideas were used selectively: [writing-for-agents](https://github.com/mattpocock/skills/blob/main/skills/productivity/writing-for-agents/SKILL.md) informed conditional pointers and completion checks; [skill mechanics](https://github.com/mattpocock/skills/blob/main/skills/productivity/writing-for-agents/SKILL-MECHANICS.md) informed independent discovery; [grilling](https://github.com/mattpocock/skills/blob/main/skills/productivity/grilling/SKILL.md) informed fact lookup and dependent questions; and [domain modeling](https://github.com/mattpocock/skills/blob/main/skills/engineering/domain-modeling/SKILL.md) informed vocabulary and concrete boundary scenarios. Read on 2026-09-04; these main-branch URLs may change. No upstream skills, invocation flags, glossary, ADR, or provider controls became required.

The semantic review retained source grounding, real imports, complete examples, framework prerequisites, failure handling, monorepo/custom-root placement, format conventions, and validation. New-file format detail moved behind its creation trigger. Fixed interviews and planning remain on the explicit full-library route. Broad research, quotas, automatic version bumps, and mandatory publishing side effects were removed from routine authoring. No context-efficiency or prompt-cache performance claim was tested.
