---
title: Configuration
id: configuration
---

Intent reads consumer configuration from the `intent` object in `package.json`. Two keys control which discovered skills Intent surfaces: `skills` (the allowlist) and `exclude` (the blocklist).

```json
{
  "intent": {
    "skills": ["@tanstack/query#fetching", "workspace:@scope/internal"],
    "exclude": ["@tanstack/router#experimental-*"]
  }
}
```

## Configuration inheritance

- **`intent.skills`:** Intent uses the nearest non-null declaration between the current working directory and the workspace or project root. A nearer declaration replaces its parent. An omitted or null value inherits the nearest parent declaration.
- **`intent.exclude`:** Intent combines arrays from the root through the current working directory, then adds excludes passed by the caller.

## `intent.skills`

`intent.skills` is a source permission allowlist. It can permit a package or one exact skill in a package. A permitted source can:

- Appear in `list` and `stale`.
- Resolve through `load`.
- Contribute mappings to `install --map`.

The default `install` command writes generic loading guidance without scanning packages. See [Trust model](./trust-model) for the reasoning and lifecycle boundaries.

A package selector permits every discovered skill in that package. An exact skill selector such as `@scope/pkg#skill` permits only that skill. Canonical package-prefixed skill names and their short aliases match each other. Skill selectors are exact: package patterns cannot include a skill segment, and skill globs are invalid.

`intent.exclude` is an explicit denial after permission is evaluated. A matching package or skill exclude always wins, including when `intent.skills` contains the same exact skill.

Source permission is not content acceptance. `intent.skills` does not pin or accept skill content. Package permission and future lock acceptance are separate policy boundaries.

### Source entries

Each array entry names one source:

| Entry | Kind | Meaning |
| ----- | ---- | ------- |
| `@scope/pkg` or `pkg` | npm | An npm package reachable through the dependency tree, direct or transitive. |
| `workspace:@scope/pkg` | workspace | A package in the current workspace. |
| `@scope/pkg#skill` or `pkg#nested/skill` | npm | One exact skill from an npm package. |
| `workspace:@scope/pkg#skill` | workspace | One exact skill from a workspace package. |
| `@scope/*` | npm | Every discovered npm package whose name matches the pattern. |
| `workspace:@scope/*` | workspace | Every discovered workspace package whose name matches the pattern. |
| `git:<host>/<repo>#<ref>` | git | Reserved. Not yet supported, and rejected until a future version adds it. |

A malformed entry fails the whole command, and every bad entry is reported at once. Package patterns support `*` wildcards, including scoped patterns such as `@tanstack/*`. Exact skill selectors do not support wildcards. Intent matches both the package name and source kind: a bare entry permits only an npm source, and a `workspace:` entry permits only a workspace source.

### Special forms

| Form | Result | Notice |
| --- | --- | --- |
| **Absent:** no `intent.skills` key | Surfaces every discovered package as an upgrade path for existing projects. A future version will require an explicit allowlist. | Deprecation notice on stderr on each run until you set `intent.skills`. |
| **Empty:** `"skills": []` | Surfaces no packages. | Info notice on stderr. |
| **Wildcard:** `"skills": ["*"]` | Surfaces every discovered package across package scopes and source kinds. This is broader than a pattern such as `@tanstack/*`. | Acknowledged-risk notice on stderr because unvetted skills may reach your agent. |

A package that is not permitted is dropped. Skills outside an exact selector are withheld while the permitted package row remains visible. In human output, Intent adds one policy notice naming sources with unlisted skills so you can opt in. Agent sessions receive only hidden source and skill counts. A package selector or exact skill selector that was not discovered is reported as a notice as well.

### Existing projects

Run `intent list` to see which packages the current policy surfaces.

A project without `intent.skills` uses the absent form: Intent surfaces every discovered package and prints its deprecation notice. Add an allowlist to permit specific sources before a future version requires one.

### Suppressing notices temporarily

Use `--no-notices` to suppress non-critical notices on stderr for one run:

```bash
npx @tanstack/intent@latest list --no-notices
npx @tanstack/intent@latest install --map --no-notices
```

For CI or wrapper scripts, set `INTENT_NO_NOTICES=1` to suppress notices without changing command arguments.

Discovery and resolution warnings are separate from policy notices and are not suppressed by these options. The acknowledged-risk notice for `"skills": ["*"]` also remains visible when other notices are suppressed.

## `intent.exclude`

`intent.exclude` removes packages or individual skills after the allowlist resolves.

Use `intent exclude` to manage this list from the CLI:

```bash
npx @tanstack/intent@latest exclude add @tanstack/router#experimental-*
npx @tanstack/intent@latest exclude remove @tanstack/router#experimental-*
npx @tanstack/intent@latest exclude list
```

```json
{
  "intent": {
    "exclude": ["@tanstack/*devtools*", "@tanstack/router#experimental-*"]
  }
}
```

Pattern grammar:

- A pattern without `#` excludes a whole package: `@scope/pkg`.
- A pattern with `#` excludes a single skill: `@scope/pkg#search-params`.
- The skill segment may be a glob: `@scope/pkg#experimental-*`.
- A pattern may cross package boundaries at skill granularity: `*#experimental-*`.
- The `#*` shortcut excludes the whole package: `@scope/pkg#*`.

Only exact names and `*` wildcards are supported on each segment. Excludes are source-kind agnostic, so a package pattern excludes matching npm and workspace sources. An excluded package does not trigger the unlisted-source notice, because an exclude is an explicit decision.
