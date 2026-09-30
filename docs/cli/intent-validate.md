---
title: intent validate
id: intent-validate
---

`intent validate` checks `SKILL.md` files and artifacts for structural problems, broken relative links, and code examples that no longer match the library API.

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

```text
@tanstack/intent@latest validate [<dir>] [--github-summary] [--fix] [--check] [--set-version <version>]
```

<!-- ::end:tabs -->

## Arguments

- `<dir>`: directory containing skills; without it, discover the applicable root and workspace skill directories
- Relative paths are resolved from the current working directory

## Options

- `--github-summary`: write a GitHub Actions step summary when `GITHUB_STEP_SUMMARY` is set
- `--check`: fail if any `SKILL.md` has fixable frontmatter migrations pending, without writing files
- `--fix`: rewrite fixable `SKILL.md` frontmatter migrations, then validate the result
- `--set-version <version>`: set `metadata.library_version` on the matched skills, then validate the result; cannot be combined with `--check`

## Set the library version

Use `--set-version` in a release step to stamp the version the skills describe:

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

@tanstack/intent@latest validate packages/query/skills --set-version 5.62.0

<!-- ::end:tabs -->

The value must be a non-empty string. Skills whose `metadata` is not a mapping are skipped. `--check` only reports pending changes and never writes, so the two options cannot be combined.

## Frontmatter migration fixes

Use `--check` in CI to detect mechanical frontmatter migrations that have not been applied:

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

@tanstack/intent@latest validate --check

<!-- ::end:tabs -->

Use `--fix` locally to apply the mechanical frontmatter migrations:

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

@tanstack/intent@latest validate --fix

<!-- ::end:tabs -->

`--fix` applies these frontmatter migrations:

- `name` values are rewritten to the parent directory leaf when the parent directory is already a legal skill name
- Top-level string fields `type`, `library`, `library_version`, and `framework` are moved under `metadata`

Equal top-level and nested values are deduplicated. If they disagree, the entire file is preserved and the conflict is reported for assessment. A successful migration does not establish that the skill's guidance is accurate for its recorded library version. Use [intent repair](./intent-repair) for a lightweight repair plan or reviewable patch without full validation.

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

- Standard top-level fields are `name`, `description`, `license`, `compatibility`, `metadata`, and `allowed-tools`. Intent also accepts top-level `sources` and `requires` arrays. Intent-specific scalars (`type`, `library`, `library_version`, `framework`) must live under `metadata`
- `metadata`, when present, is a mapping of string values
- `description` length is at most 1024 characters
- `type: framework` requires `requires` to be an array
- Total file length is at most 500 lines

### Code examples and links

TypeScript and JavaScript fences (`ts`, `tsx`, `typescript`, `js`, `jsx`, and `javascript`) are checked as separate source files in one compiler context per package, against the library's source or tracked public declarations. Workspace imports resolve to their owning packages. Missing exports, incompatible options, and syntax errors fail validation with the skill path and line number; deprecated imports produce warnings. Names and external modules intentionally omitted from partial examples are tolerated. JavaScript libraries can supply JSDoc contracts without a separate type declaration entry. JSX and TSX examples check component props and syntax; they do not render components or prove framework behavior. Standalone backtick and tilde fences support longer closing markers and end-of-file closure, while nested fences inside a Markdown example remain data. The checker does not execute examples.

The checker enables strict null checks because some library APIs require them, while tolerating omitted names, shorthand values, and implicit parameter types. Each code fence represents one example. Separate before/after implementations into distinct fences; use `diff` or `text` for deliberately invalid code or fragments that cannot be checked as a source file. The checker does not infer those distinctions from prose or comments.

Module augmentations and global declarations still share the package compiler context. Two examples that pass separately can conflict when checked together. Verify those examples in isolated fixtures before treating the combined diagnostics as defects in the guidance; separate fences alone do not isolate their augmentations.

TypeScript 5.0 or newer must be available in the repository for code checking. If it or the library type entry is unavailable, Intent reports why those checks were skipped; this is not a successful typecheck. Prose-only skills do not load TypeScript.

Relative Markdown links outside fenced examples must point to an existing file or directory. External URLs and anchors are not checked. Link checks still run when TypeScript is unavailable. Repeated validations read current source files and link targets.

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
