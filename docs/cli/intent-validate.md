---
title: intent validate
id: intent-validate
---

`intent validate` checks `SKILL.md` files and artifacts for structural problems.

```bash
npx @tanstack/intent@latest validate [<dir>]
```

## Arguments

- `<dir>`: directory containing skills; default is `skills`
- Relative paths are resolved from the current working directory

## Validation checks

For each discovered `SKILL.md`:

- Frontmatter delimiter and structure are valid
- YAML frontmatter parses successfully
- Required fields exist: `name`, `description`
- `name` matches skill directory path under the target root
- `description` length is at most 1024 characters
- `type: framework` requires `requires` to be an array
- Total file length is at most 500 lines

If `<dir>/_artifacts` exists, it also validates artifacts:

- Required files: `domain_map.yaml`, `skill_spec.md`, `skill_tree.yaml`
- Required files must be non-empty
- `.yaml` artifacts must parse successfully

## Packaging warnings

Packaging warnings are always computed from `package.json` in the current working directory:

- `@tanstack/intent` missing from `devDependencies`
- Missing `tanstack-intent` in keywords array
- Missing `files` entries when `files` array exists:
  - `skills`
  - `!skills/_artifacts`

Warnings are informational; they are printed on both pass and fail paths.

## Common errors

- Missing target directory: `Skills directory not found: <abs-path>`
- No skill files discovered: `No SKILL.md files found`
- Validation failures: aggregated file-specific errors and count

## Related

- [intent scaffold](./intent-scaffold)
- [setup commands](./intent-setup)
