# Generate a TanStack Playbook Skill

You are generating a single TanStack Playbook skill file (`SKILL.md`).

## Inputs

- `library`: one of `query`, `router`, `db`, `form`, `table`
- `skill`: the skill name (e.g. `core`, `infinite`, `loaders`)
- `sourceDocs`: list of docs paths and/or URLs to use as sources
- `relatedSkills`: list of skill ids that should be referenced in `metadata.skills`

## Output

Create `skills/tanstack-<library>/<skill>/SKILL.md` with:

- YAML frontmatter
- Skill content following the required section order

## Frontmatter Schema

```yaml
---
name: 'tanstack-<library>/<skill>'
description: '<concise, action-oriented>'
triggers:
  - '<short trigger phrase>'
metadata:
  sources:
    - '<repo-or-url>:<path-or-glob>'
  skills:
    - 'tanstack-<library>/<other-skill>'
---
```

## Required Sections (in order)

1. Purpose
2. When to use
3. When NOT to use
4. Minimal example
5. Common patterns
6. Common mistakes
7. Related references

## Content Rules

- React adapter only (Phase 1).
- No marketing or documentation prose. Write for an agent following steps.
- No TypeScript or React basics.
- Use real package imports (no pseudocode imports).
- All examples must be minimal but complete and runnable.
- `SKILL.md` must be under 500 lines.
- Put large tables and full API lists in `references/`.

## Minimal Example Requirements

- Must compile and run in a typical React app.
- Include all required imports and setup.
- Prefer the smallest possible working sample.

## Common Patterns Requirements

- Provide 2-4 patterns with working examples.
- Each pattern should have a short rationale and a code example.

## Common Mistakes Requirements

- Provide at least 3 mistakes.
- Each mistake must include:
  - Wrong example
  - Correct example
  - Explanation of what was wrong

## Related References

- Link to `references/` docs and related skills only.
- Use relative links.

## Review Checklist

- [ ] Frontmatter fields populated (`name`, `description`, `triggers`, `metadata.sources`, `metadata.skills`).
- [ ] All required sections present and in order.
- [ ] Minimal example is complete and runnable.
- [ ] Common patterns include working examples.
- [ ] Common mistakes include wrong + correct examples and explanations.
- [ ] File under 500 lines.
