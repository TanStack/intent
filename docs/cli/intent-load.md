---
title: intent load
id: intent-load
---

`intent load` loads a compact skill identity from the current install and prints the matching `SKILL.md` content.

```bash
npx @tanstack/intent@latest load <package>#<skill> [--path] [--json] [--debug] [--global] [--global-only]
```

## Options

- `--path`: print the resolved skill path instead of the file content
- `--json`: print structured JSON with metadata and content
- `--debug`: print resolution debug details to stderr
- `--global`: load from project packages first, then global packages
- `--global-only`: load from global packages only

## What you get

### Resolution

- Validates `<package>#<skill>` before scanning
- Scans project-local packages by default
- Includes global packages only when `--global` or `--global-only` is passed
- Checks the requested package and skill against `package.json#intent.skills` before resolution
- Rechecks the actual source kind and canonical skill name after fast-path resolution
- Refuses before scanning when the target package or skill matches `intent.exclude`

### Selection

- Prefers local packages when `--global` is used and the same package exists locally and globally
- Accepts an unambiguous short skill name when a package-prefixed skill exists

### Output

- Prints raw `SKILL.md` content by default
- Prints the scanner-reported path when `--path` is passed
- Prints debug details to stderr when `--debug` is passed

A successful load proves that Intent resolved the selected skill under current policy and returned its content. It does not prove that the skill was relevant to the task, reached an agent's active context, or was followed correctly. See [Lifecycle boundaries](../concepts/trust-model#lifecycle-boundaries).

The package can be scoped or unscoped. The skill can include slash-separated sub-skill names.

`package.json#intent.skills` can permit the whole package or one exact skill. For example, `@tanstack/query` permits every skill in that npm package, while `@tanstack/query#fetching` permits only `fetching`. Exact selectors match canonical package-prefixed skill names and their short aliases. They do not support skill globs.

Examples:

```bash
npx @tanstack/intent@latest load @tanstack/query#fetching
npx @tanstack/intent@latest load @tanstack/query#core/fetching
npx @tanstack/intent@latest load @tanstack/router-core#auth-and-guards
npx @tanstack/intent@latest load some-lib#core --path
```

## JSON output

`--json` prints:

```json
{
  "package": "@tanstack/query",
  "skill": "fetching",
  "path": "node_modules/@tanstack/query/skills/fetching/SKILL.md",
  "packageRoot": "node_modules/@tanstack/query",
  "source": "local",
  "version": "5.0.0",
  "content": "---\nname: fetching\n---\n\n...",
  "warnings": []
}
```

## Common errors

### Invalid skill identity

- Missing separator: `Invalid skill use "@tanstack/query": expected <package>#<skill>.`
- Empty package: `Invalid skill use "#core": package is required.`
- Empty skill: `Invalid skill use "@tanstack/query#": skill is required.`

### Resolution failures

- Missing package: `Cannot resolve skill use "...": package "..." was not found.`
- Missing skill: `Cannot resolve skill use "...": skill "..." was not found in package "...".`
- Skill suggestion: `Did you mean @tanstack/router-core#router-core/auth-and-guards?`

### Policy refusals

- Unlisted package: `Cannot load skill use "...": package "..." is not listed in intent.skills.`
- Unlisted skill: `Cannot load skill use "...": skill "..." is not listed in intent.skills.`
- Excluded package: `Cannot load skill use "...": package "..." is excluded by Intent configuration.`
- Excluded skill: `Cannot load skill use "...": skill "..." is excluded by Intent configuration.`

## Related

- [intent list](./intent-list)
- [intent install](./intent-install)
- [Trust model](../concepts/trust-model)
- [Configuration](../concepts/configuration)
