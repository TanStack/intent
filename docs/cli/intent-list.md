---
title: intent list
id: intent-list
---

`intent list` shows the skills your project can use. It scans installed dependencies and workspace packages, applies your `intent.skills` policy, and prints the packages and skills that reach your agent.

<!-- ::start:tabs variant="package-manager" mode="local-install" -->
npx @tanstack/intent@latest list [--json] [--debug] [--global] [--global-only] [--show-hidden] [--why] [--no-notices]
<!-- ::end:tabs -->

## Options

- `--json`: print the machine-readable list instead of the text tables.
- `--global`: include global packages after the project packages.
- `--global-only`: list global packages only.
- `--show-hidden`: also list sources that `intent.skills` does not permit, so you can decide what to enable. Has no effect in an agent session.
- `--why`: explain why each skill is shown or hidden. Has no effect in an agent session.
- `--debug`: print discovery details to stderr.
- `--no-notices`: suppress non-critical notices on stderr for this run.

## What it shows

`list` prints a summary line, a package table with `PACKAGE`, `SOURCE`, `VERSION`, and `SKILLS` columns, and a skill tree grouped by package. `SOURCE` shows whether a package came from local discovery or global scanning; when the same package is found both locally and globally, the local one is used. If nothing is found, `list` prints `No intent-enabled packages found.`

Warnings print under `Warnings:` (each prefixed `⚠`), and notices print under `Notices:` on stderr (each prefixed `ℹ`). Suppress notices for one run with `--no-notices`, or set `INTENT_NO_NOTICES=1` for CI and wrapper scripts.

`list` scans the project's `node_modules`, or Yarn's Plug'n'Play API when there is no usable `node_modules`. It reads package files only and never runs package code; see the [trust model](../concepts/trust-model).

## Which packages appear

`list` shows only packages permitted by `package.json#intent.skills`, then removes anything matched by `intent.exclude`. A missing or empty `intent.skills` permits nothing, so `list` shows no packages until you add a source; the exact `"*"` entry shows every discovered package. See [Configuration](../concepts/configuration) for the entry grammar and special forms.

A package that ships skills but is not permitted is hidden. Outside an agent session, `list` names hidden sources; `--show-hidden` lists them and `--why` explains each decision. In an agent session, hidden sources are reported by count only, so run `intent list --show-hidden` outside the session to review candidates. An entry that matches no discovered package is reported too.

## JSON output

`--json` prints a stable shape for tools and agents:

```json
{
  "skills": [
    {
      "use": "@tanstack/query#fetching",
      "packageName": "@tanstack/query",
      "packageRoot": "/path/to/project/node_modules/@tanstack/query",
      "packageVersion": "5.0.0",
      "packageSource": "local",
      "skillName": "fetching",
      "description": "Query data fetching patterns"
    }
  ],
  "packages": [
    {
      "name": "@tanstack/query",
      "version": "5.0.0",
      "source": "local",
      "packageRoot": "/path/to/project/node_modules/@tanstack/query",
      "skillCount": 1
    }
  ],
  "hiddenSourceCount": 1,
  "hiddenSources": [
    {
      "name": "hidden-package",
      "skillCount": 1
    }
  ],
  "warnings": ["string"],
  "conflicts": [
    {
      "packageName": "string",
      "chosen": { "version": "string", "packageRoot": "string" },
      "variants": [{ "version": "string", "packageRoot": "string" }]
    }
  ]
}
```

Each skill also carries `type` and `framework` when the skill sets them. In an agent session, package paths are blanked and `conflicts` is empty.

## Common errors

- Scanner failures print as errors.
- Unsupported environments, such as Deno projects without `node_modules`. `list` needs a resolvable `node_modules` or a Yarn Plug'n'Play setup.

## Related

- [Configuration](../concepts/configuration) - the `intent.skills` and `intent.exclude` grammar.
- [Trust model](../concepts/trust-model) - why discovery does not grant trust.
- [`intent load`](./intent-load) - print a matching skill's `SKILL.md`.
