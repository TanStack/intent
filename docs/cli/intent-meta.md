---
title: intent meta
id: intent-meta
---

`intent meta` lists bundled meta-skills or prints one meta-skill file.

```bash
npx @tanstack/intent@latest meta
npx @tanstack/intent@latest meta <name>
```

## Arguments

- `<name>` is a meta-skill directory under `node_modules/@tanstack/intent/meta/`
- Rejected values: any name containing `..`, `/`, or `\\`

## Output

- Without `<name>`:
  - one line per meta-skill
  - `name` + description from frontmatter
  - description is normalized and truncated to 60 characters
- With `<name>`:
  - Markdown from `meta/<name>/SKILL.md`
  - relative links within the package resolve from the caller's directory, using absolute paths when needed
  - reference files remain separate and are read only when their linked procedure is needed

## Common errors

- Meta directory not found
- Invalid `<name>` format
- Unknown `<name>` (message suggests running `npx @tanstack/intent meta`)
- Read failure for target `SKILL.md`
