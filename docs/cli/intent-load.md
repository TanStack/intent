---
title: intent load
id: intent-load
---

`intent load` prints the `SKILL.md` for a skill in one of your trusted packages, matched to the version installed in your project. Your coding agent runs it to pull a skill's guidance into context, and you can run it yourself to read one.

<!-- ::start:tabs variant="package-manager" mode="local-install" -->
@tanstack/intent@latest load <package>#<skill> [--path] [--json] [--debug] [--global] [--global-only]
<!-- ::end:tabs -->

The package may be scoped or unscoped, and the skill may include slash-separated sub-skill names. An unambiguous short skill name works when only one package-prefixed skill matches.

<!-- ::start:tabs variant="package-manager" mode="local-install" -->
@tanstack/intent@latest load @tanstack/query#fetching
@tanstack/intent@latest load @tanstack/query#core/fetching
@tanstack/intent@latest load some-lib#core --path
<!-- ::end:tabs -->

## Options

- `--path`: print the resolved file path instead of the content. Cannot be combined with `--json`.
- `--json`: print the content plus metadata as JSON. Cannot be combined with `--path`.
- `--debug`: print resolution details to stderr.
- `--global`: load from project packages first, then global packages.
- `--global-only`: load from global packages only.

## What it checks

Before printing anything, `load` confirms the skill is one you are allowed to use:

- The package must be permitted by `package.json#intent.skills`, and must not be removed by `intent.exclude`.
- If `intent.lock` exists, the skill must be recorded in it and its content must still match the accepted hash. `load` refuses a skill that was never accepted or whose content changed since you accepted it. Run `intent install` to review and accept a new baseline.

Without a lockfile, `load` applies the source policy only and does not check content. It reads project packages by default; `--global` and `--global-only` add or switch to global packages, and a local package wins when the same one exists in both.

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

- **Malformed use.** `Invalid skill use "@tanstack/query": expected <package>#<skill>.`, or a similar message for an empty package or skill.
- **Not found.** `Cannot resolve skill use "...": package "..." was not found.`, or the same for a missing skill, sometimes with a `Did you mean ...?` suggestion.
- **Not trusted.** `Cannot load skill use "...": package "..." is not listed in intent.skills.`
- **Excluded.** `Cannot load skill use "...": package "..." is excluded by Intent configuration.`, or the same for a skill.
- **Not accepted.** `Cannot load skill use "...": skill is not accepted in intent.lock.`
- **Content changed.** `Cannot load skill use "...": installed content does not match intent.lock.`

## Related

- [`intent list`](./intent-list) - find loadable skills.
- [`intent install`](./intent-install) - accept skills into the lockfile.
- [Trust model](../concepts/trust-model) - how the policy and lockfile gate loading.
- [Configuration](../concepts/configuration) - the `intent.skills` and `intent.exclude` grammar.
