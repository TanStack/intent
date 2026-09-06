# Format for a new skill

Use the repository's established layout. With no existing convention, write `skills/<task-name>/SKILL.md` in the package that owns the task. The final path segment becomes `name`; nested paths belong in directories, not names.

## Frontmatter

```yaml
---
name: '[task-name]'
description: >
  Use when [concrete developer tasks or conditions] with [library/framework]. [Adjacent-task boundary, when needed.]
metadata:
  purpose: '[Descriptive explanation of what this skill is for.]'
  type: core
  library: '[package name]'
  library_version: '[verified target version]'
sources:
  - '[Owner/repo]:src/[relevant-file].ts'
  - '[Owner/repo]:docs/[relevant-guide].md'
---
```

Replace template values with evidence from the library. `name` uses only lowercase letters, numbers, and hyphens, matches its parent directory, and is at most 64 characters. `description` is at most 1024 characters. Intent-specific scalars belong under `metadata`, whose values are strings. Intent supports top-level `sources` and `requires` arrays. Source entries use `Owner/repo:relative-path`; globs are supported, but select paths relevant to the task. If the repository or target version cannot be established, report that uncertainty instead of inventing provenance.

Follow [Agent Skills description guidance](https://agentskills.io/skill-creation/optimizing-descriptions). Keep library context and explicit use conditions in `description`; it must communicate the supported task without requiring custom metadata. Check actual discovery using [discovery checks](task-quality.md#check-discovery-separately).

### Purpose and activation

`description` is the standard agent-discovery field. Write concrete “Use when…” conditions that identify what the agent can accomplish and distinguish adjacent tasks. `metadata.purpose` is Intent's descriptive explanation of what the skill is for, stored as a string in the standard [metadata extension point](https://agentskills.io/specification#metadata-field).

For a new skill, author both fields. For an existing skill without `metadata.purpose`, read its description before editing and preserve that text unchanged as purpose, then write the activation description. Use the actual pre-edit content, not a rewritten draft or a newly invented summary. If purpose already exists, preserve it; subsequent edits to activation conditions do not replace it. If the source proves that a preserved purpose is inaccurate, report the conflict and propose the smallest correction explicitly rather than silently changing its meaning during migration.

Keep purpose and activation scope aligned when maintaining the skill. Existing third-party skills without purpose remain valid; the field is an Intent authoring convention, not a universal Agent Skills requirement. Structural validation checks its string type through the metadata contract, not the quality of the prose or a literal “Use when” prefix.

Use the type that matches the task, without designing a new taxonomy:

| Type          | Use for                                                  |
| ------------- | -------------------------------------------------------- |
| `core`        | A standalone framework-agnostic task                     |
| `sub-skill`   | A task within established parent guidance                |
| `framework`   | Framework-specific bindings, hooks, or providers         |
| `lifecycle`   | A developer journey such as getting started or migration |
| `composition` | The integration between libraries                        |
| `security`    | A security verification task                             |

Framework skills put the framework name under `metadata.framework`, declare `requires` for their core guidance, and open with a dependency note explaining what to read first. Sub-skills and compositions declare real prerequisites and point to their existing owners. Do not create empty prerequisite skills. If no core guidance is needed, a framework skill still needs a `requires` array for validation; use `[]` only after verifying it has no skill dependency.

## Body

For a usage task, keep Setup → Core Patterns → Common Mistakes as the default section order, including only sections with necessary, source-backed content.

- **Setup:** a minimal working example with exact imports and the initialization needed for this task. Keep framework hooks/providers in framework guidance.
- **Core Patterns:** the examples needed to finish the task. Each has an action-oriented heading, complete code, and any non-obvious explanation.
- **Common Mistakes:** plausible incorrect patterns with the supported alternative, the failure mechanism, and a doc/source/issue citation. Include failure handling and prerequisites even when failure is an obvious error rather than a silent one. Prioritize security/data loss (CRITICAL), common incorrect behavior (HIGH), then conditional edge cases (MEDIUM).
- **Completion:** how to check the task succeeded and what to do on failure.
- **References:** only necessary conditional detail, each with a reading trigger.

Example pointer (create the reference only for a real retry branch):

```markdown
When configuring retries, read [retry behavior](references/retries.md) before choosing a policy.
```

For a verification task (security, go-live, migration audit), use checks instead of setup/patterns: state what to inspect, the expected result, the failure condition, and the remediation. Include sourced mistakes and a final completion check. Use the applicable checklist template in [tree-generator's writing reference](../../tree-generator/references/write-skills.md#step-7--write-checklistaudit-skills-where-applicable) only when that detailed format is needed.

For an entry selected from a full-library tree, retain its package placement, dependencies, failure-mode status, and cross-skill relationships. Read the applicable type template in [the tree writing reference](../../tree-generator/references/write-skills.md) when generating overview registries, framework trees, compositions, or cross-domain tension notes. The focused procedure remains in [generate-skill](../SKILL.md).

## Commands and bundled scripts

Apply [Agent Skills script guidance](https://agentskills.io/skill-creation/using-scripts) when the task needs automation. Reuse an existing CLI before adding a helper. Bundle a tested `scripts/` file when complex or repeated logic warrants it; a usage skill does not need scripts by default.

Document prerequisites, dependency versions, inputs, and the execution directory. Resolve bundled script paths from the skill directory; distinguish them from paths in the consumer's project. State when to run each script. Avoid implicit dependency installation; use the project's available runtime and require authorization for changes to it.

Accept arguments or stdin without interactive prompts. Provide concise `--help`, actionable errors, and meaningful exit codes. Keep structured results on stdout and diagnostics on stderr; bound large output or write it to a file. Make retries safe and provide a preview for state-changing operations where needed.

Run the documented invocation against valid and invalid input. Verify execution from the installed package layout, not only the author's checkout. Report unavailable runtime or packaging checks as unverified.
