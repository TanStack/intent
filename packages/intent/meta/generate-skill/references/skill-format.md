# Format for a new skill

Use the repository's established layout. With no existing convention, write `skills/<task-name>/SKILL.md` in the package that owns the task. The final path segment becomes `name`; nested paths belong in directories, not names.

## Frontmatter

```yaml
---
name: '[task-name]'
description: >
  [When an agent should load this skill to perform the developer task.]
metadata:
  type: core
  library: '[package name]'
  library_version: '[verified target version]'
sources:
  - '[Owner/repo]:src/[relevant-file].ts'
  - '[Owner/repo]:docs/[relevant-guide].md'
---
```

Replace template values with evidence from the library. `name` uses only lowercase letters, numbers, and hyphens, matches its parent directory, and is at most 64 characters. `description` is at most 1024 characters. Intent-specific scalars belong under `metadata`, whose values are strings. Intent supports top-level `sources` and `requires` arrays. Source entries use `Owner/repo:relative-path`; globs are supported, but select paths relevant to the task. If the repository or target version cannot be established, report that uncertainty instead of inventing provenance.

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
When configuring retries, read [retry behavior](references/retries.md)
before choosing a policy.
```

For a verification task (security, go-live, migration audit), use checks instead of setup/patterns: state what to inspect, the expected result, the failure condition, and the remediation. Include sourced mistakes and a final completion check. Use the applicable checklist template in [tree-generator's writing reference](../../tree-generator/references/write-skills.md#step-7--write-checklistaudit-skills-where-applicable) only when that detailed format is needed.

For an entry selected from a full-library tree, retain its package placement, dependencies, failure-mode status, and cross-skill relationships. Read the applicable type template in [the tree writing reference](../../tree-generator/references/write-skills.md) when generating overview registries, framework trees, compositions, or cross-domain tension notes. The focused procedure remains in [generate-skill](../SKILL.md).
