---
title: intent validate
id: intent-validate
---

`intent validate` checks `SKILL.md` files and artifacts for structural problems.

```bash
npx @tanstack/intent@latest validate [<dir>] [--github-summary] [--fix] [--check]
```

## Arguments

- `<dir>`: directory containing skills; default is `skills`
- Relative paths are resolved from the current working directory

## Options

- `--github-summary`: write a GitHub Actions step summary when `GITHUB_STEP_SUMMARY` is set
- `--check`: fail if any `SKILL.md` has fixable frontmatter migrations pending, without writing files
- `--fix`: rewrite fixable `SKILL.md` frontmatter migrations, then validate the result

## Frontmatter migration fixes

Use `--check` in CI to detect mechanical frontmatter migrations that have not been applied:

```bash
npx @tanstack/intent@latest validate --check
```

Use `--fix` locally to apply the mechanical frontmatter migrations:

```bash
npx @tanstack/intent@latest validate --fix
```

`--fix` only rewrites unambiguous frontmatter migrations:

- `name` values are rewritten to the parent directory leaf when the parent directory is already a legal skill name
- Top-level string fields `type`, `library`, `library_version`, and `framework` are moved under `metadata`

`--fix` does not rewrite authoring-judgment validation errors:

- Missing or invalid `description`
- Length-limit failures
- Invalid `metadata` shape or non-string `metadata` values
- Missing `requires` for framework skills
- Artifact validation failures

## Validation checks

For each discovered `SKILL.md`:

- Frontmatter delimiter and structure are valid
- YAML frontmatter parses successfully
- Required fields exist: `name`, `description`
- `name` is a single leaf segment matching the skill's parent directory (no slashes); the namespace is carried by the directory path
- `name` uses only lowercase letters, numbers, and hyphens
- `name` is at most 64 characters
- Only spec top-level keys are allowed (`name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools`); Intent-specific scalars (`type`, `library`, `library_version`, `framework`) must live under `metadata`
- `metadata`, when present, is a mapping of string values
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
