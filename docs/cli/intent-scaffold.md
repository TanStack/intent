---
title: intent scaffold
id: intent-scaffold
---

`intent scaffold` prints a phased scaffold prompt for generating skills.

```bash
npx @tanstack/intent@latest scaffold
```

## Behavior

- Prints prompt text to stdout
- Does not create files

## Output

The printed prompt defines three ordered phases:

1. `domain-discovery`
2. `tree-generator`
3. `generate-skill`

Each phase includes a stop gate before continuing.

The prompt also includes a post-generation checklist:

- Run `npx @tanstack/intent@latest validate` and fix issues
- Commit generated `skills/` and `skills/_artifacts/`
- Ensure `@tanstack/intent` is in `devDependencies`
- Run setup commands as needed:
  - `npx @tanstack/intent@latest add-library-bin`
  - `npx @tanstack/intent@latest edit-package-json`
  - `npx @tanstack/intent@latest setup-github-actions`

## Related

- [intent validate](./intent-validate)
- [setup commands](./intent-setup)
