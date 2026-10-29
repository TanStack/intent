---
title: intent load
id: intent-load
---

`intent load` loads a compact skill identity from the current install and prints its guidance. For a skill with `intent-transform`, it calls the module's `load()` function and prints the returned Markdown instead of the packaged body.

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

```text
@tanstack/intent@latest load <package>#<skill> [...args] [--path] [--json] [--debug] [--global] [--global-only]
```

<!-- ::end:tabs -->

## Options

Trailing positional arguments are forwarded to the transform as `args`, an array of strings (empty by default). Their meaning is defined by the skill. For example, a skill could support:

```sh
npx @tanstack/intent@latest load '@apollo/client#apollo-client' reconfigure
```

Use `--` before arguments that begin with a dash. Arguments have no effect for skills without a transform or when using `--path`.

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
- Checks the target package name against `package.json#intent.skills` before resolution, then enforces its source kind after resolution
- Refuses before scanning when the target package or skill matches `intent.exclude`

### Selection

- Prefers local packages when `--global` is used and the same package exists locally and globally
- Accepts an unambiguous short skill name when a package-prefixed skill exists

### Output

- Prints `SKILL.md` content, or the transform's returned string, with relative Markdown links resolved for the consumer
- Prints the scanner-reported path when `--path` is passed
- Prints debug details to stderr when `--debug` is passed

A successful load proves that Intent resolved the selected skill under current policy and returned its content. It does not prove that the skill was relevant to the task, reached an agent's active context, or was followed correctly. See [Lifecycle boundaries](../concepts/trust-model#lifecycle-boundaries).

The package can be scoped or unscoped. The skill can include slash-separated sub-skill names.

Examples:

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

@tanstack/intent@latest load @tanstack/query#fetching
@tanstack/intent@latest load @tanstack/query#core/fetching
@tanstack/intent@latest load @tanstack/router-core#auth-and-guards
@tanstack/intent@latest load some-lib#core --path

<!-- ::end:tabs -->

## JSON output

Transform functions receive `commands.load` and `commands.configure` so their instructions can reuse the detected launcher, including npm scripts and npx package tags. See [Invocation-aware instructions](../concepts/skill-transforms#invocation-aware-instructions).

For transformed skills, `content` contains the individualized output while `path` continues to identify the original packaged `SKILL.md`. `--path` never executes a transform.

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

Transforms require Node.js 22+ and can fail on invalid declarations, invalid output, or execution limits. Configuration writes are committed only after successful execution. See [Skill transforms](../concepts/skill-transforms).

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
- Excluded package: `Cannot load skill use "...": package "..." is excluded by Intent configuration.`
- Excluded skill: `Cannot load skill use "...": skill "..." is excluded by Intent configuration.`

## Related

- [intent configure](./intent-configure)
- [Skill transforms](../concepts/skill-transforms)
- [intent list](./intent-list)
- [intent install](./intent-install)
- [Trust model](../concepts/trust-model)
- [Configuration](../concepts/configuration)
