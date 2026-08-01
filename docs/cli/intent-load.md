---
title: intent load
id: intent-load
---

`intent load` prints the `SKILL.md` for a skill in one of your trusted packages, matched to the version installed in your project. Your coding agent runs it to pull a skill's guidance into context, and you can run it yourself to read one.

<!-- ::start:tabs variant="package-manager" mode="local-install" -->
@tanstack/intent@latest load <package>#<skill> [--path] [--json] [--debug]
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

## What it checks

Before printing anything, `load` confirms the skill is one you are allowed to use:

- The package must be permitted by `package.json#intent.skills`, and must not be removed by `intent.exclude`.
- `intent.lock` must exist, the skill must be recorded in it, and its content must still match the accepted hash. `load` refuses missing, unaccepted, or changed content. Run `intent install` interactively to review and accept a baseline.

`load` reads project packages accepted in `intent.lock`.

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

For explicit agent output (`INTENT_AUDIENCE=agent`), `path` and `packageRoot` are blank unless `--debug` is also present. `--path` always prints the requested path.

## Common errors

- **Malformed use.** `Invalid skill use "@tanstack/query": expected <package>#<skill>.`, or a similar message for an empty package or skill.
- **Missing lock.** `Cannot load skill use "...": intent.lock is missing.` A human is told to run interactive install; an agent is told to pause and ask the user.
- **Invalid lock.** `Cannot load skill use "...": intent.lock is invalid: ...` followed by the same human or agent review instruction.
- **Not found.** Missing packages direct humans to `intent list`; missing skills provide up to three portable suggestions or direct to `intent list <package>`. Hidden package and skill names are not enumerated.
- **Not trusted.** `Cannot load skill use "...": package "..." is not listed in intent.skills.`
- **Excluded.** `Cannot load skill use "...": package "..." is excluded by Intent configuration.`, or the same for a skill.
- **Not accepted.** `Cannot load skill use "...": skill is not accepted in intent.lock.`
- **Content changed.** `Cannot load skill use "...": installed content does not match intent.lock.` Not-accepted and changed-content errors tell a human to run interactive install and tell an agent to pause and ask the user.

## Related

- [`intent list`](./intent-list) - find loadable skills.
- [`intent install`](./intent-install) - accept skills into the lockfile.
- [Trust model](../concepts/trust-model) - how the policy and lockfile gate loading.
- [Configuration](../concepts/configuration) - the `intent.skills` and `intent.exclude` grammar.
