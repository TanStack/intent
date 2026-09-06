---
title: intent meta
id: intent-meta
---

`intent meta` lists bundled meta-skills or prints one meta-skill file.

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

```text
react: @tanstack/intent@latest meta
react: @tanstack/intent@latest meta <name>
solid: @tanstack/intent@latest meta
solid: @tanstack/intent@latest meta <name>
vue: @tanstack/intent@latest meta
vue: @tanstack/intent@latest meta <name>
svelte: @tanstack/intent@latest meta
svelte: @tanstack/intent@latest meta <name>
angular: @tanstack/intent@latest meta
angular: @tanstack/intent@latest meta <name>
lit: @tanstack/intent@latest meta
lit: @tanstack/intent@latest meta <name>
```

<!-- ::end:tabs -->

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
- Unknown `<name>` (message suggests listing the available meta-skills)
- Read failure for target `SKILL.md`
