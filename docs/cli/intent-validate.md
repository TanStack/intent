---
title: intent validate
id: intent-validate
---

`intent validate` checks `SKILL.md` files and artifacts for structural problems.

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

```text
react: @tanstack/intent@latest validate [<dir>] [--github-summary] [--fix] [--check] [--set-version <version>]
solid: @tanstack/intent@latest validate [<dir>] [--github-summary] [--fix] [--check] [--set-version <version>]
vue: @tanstack/intent@latest validate [<dir>] [--github-summary] [--fix] [--check] [--set-version <version>]
svelte: @tanstack/intent@latest validate [<dir>] [--github-summary] [--fix] [--check] [--set-version <version>]
angular: @tanstack/intent@latest validate [<dir>] [--github-summary] [--fix] [--check] [--set-version <version>]
lit: @tanstack/intent@latest validate [<dir>] [--github-summary] [--fix] [--check] [--set-version <version>]
```

<!-- ::end:tabs -->

## Arguments

- `<dir>`: directory containing skills; default is `skills`
- Relative paths are resolved from the current working directory

## Options

- `--github-summary`: write a GitHub Actions step summary when `GITHUB_STEP_SUMMARY` is set
- `--check`: fail if any `SKILL.md` has fixable frontmatter migrations pending, without writing files
- `--fix`: rewrite fixable `SKILL.md` frontmatter migrations, then validate the result
- `--set-version <version>`: set `metadata.library_version` on the matched skills, then validate the result; cannot be combined with `--check`

## Set the library version

Use `--set-version` in a release step to stamp the version the skills describe:

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: @tanstack/intent@latest validate packages/query/skills --set-version 5.62.0
solid: @tanstack/intent@latest validate packages/query/skills --set-version 5.62.0
vue: @tanstack/intent@latest validate packages/query/skills --set-version 5.62.0
svelte: @tanstack/intent@latest validate packages/query/skills --set-version 5.62.0
angular: @tanstack/intent@latest validate packages/query/skills --set-version 5.62.0
lit: @tanstack/intent@latest validate packages/query/skills --set-version 5.62.0

<!-- ::end:tabs -->

The value must be a non-empty string. Skills whose `metadata` is not a mapping are skipped. `--check` only reports pending changes and never writes, so the two options cannot be combined.

## Frontmatter migration fixes

Use `--check` in CI to detect mechanical frontmatter migrations that have not been applied:

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: @tanstack/intent@latest validate --check
solid: @tanstack/intent@latest validate --check
vue: @tanstack/intent@latest validate --check
svelte: @tanstack/intent@latest validate --check
angular: @tanstack/intent@latest validate --check
lit: @tanstack/intent@latest validate --check

<!-- ::end:tabs -->

Use `--fix` locally to apply the mechanical frontmatter migrations:

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: @tanstack/intent@latest validate --fix
solid: @tanstack/intent@latest validate --fix
vue: @tanstack/intent@latest validate --fix
svelte: @tanstack/intent@latest validate --fix
angular: @tanstack/intent@latest validate --fix
lit: @tanstack/intent@latest validate --fix

<!-- ::end:tabs -->

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

### File structure

- Frontmatter delimiter and structure are valid
- YAML frontmatter parses successfully
- Required fields exist: `name`, `description`
- `name` is a single leaf segment matching the skill's parent directory (no slashes); the namespace is carried by the directory path
- `name` uses only lowercase letters, numbers, and hyphens and is at most 64 characters

### Field rules

- Only spec top-level keys are allowed (`name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools`); Intent-specific scalars (`type`, `library`, `library_version`, `framework`) must live under `metadata`
- `metadata`, when present, is a mapping of string values
- `description` length is at most 1024 characters
- `type: framework` requires `requires` to be an array
- Total file length is at most 500 lines

### Artifacts

When `<dir>/_artifacts` exists, Intent also checks:

- Required files: `domain_map.yaml`, `skill_spec.md`, `skill_tree.yaml`
- Required files must be non-empty
- `.yaml` artifacts must parse successfully

## Packaging warnings

Packaging warnings are computed from the `package.json` that owns the validated skills:

- `@tanstack/intent` missing from `devDependencies` (in a monorepo, the workspace root's `devDependencies` also count)
- Missing `tanstack-intent` in keywords array
- A skill directory not covered by the `files` array, when that array exists. Either `skills` or the per-skill `skills/<name>` entries that `intent maintainer sync` writes cover a skill; the warning names the uncovered directory.
- Missing `!skills/_artifacts` when the whole `skills` directory is published, `skills/_artifacts` exists, and the package is not in a monorepo

Warnings are informational; they are printed on both pass and fail paths.

## Common errors

- Missing target directory: `Skills directory not found: <abs-path>`
- No skill files discovered: `No SKILL.md files found`
- Validation failures: aggregated file-specific errors and count

## Related

- [intent maintainer](./intent-maintainer)
- [setup commands](./intent-setup)
