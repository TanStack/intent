---
title: Configuration
id: configuration
---

Intent reads consumer configuration from the `intent` object in `package.json`. Two keys control which discovered skills Intent surfaces: `skills` (the allowlist) and `exclude` (the blocklist).

```json
{
  "intent": {
    "skills": ["@tanstack/query", "workspace:@scope/internal"],
    "exclude": ["@tanstack/router#experimental-*"]
  }
}
```

Intent resolves `skills` from the nearest `package.json` between the current working directory and the workspace or project root that declares a non-null value. A nearer declaration replaces a parent declaration; an omitted or null value inherits the nearest parent declaration. Intent combines `exclude` arrays from the root through the current working directory, then adds excludes passed by the caller.

## `intent.skills`

`intent.skills` is a package-source allowlist. Permitted packages surface in `list` and `stale`, can resolve through `load`, and contribute mappings to `install --map`. The default `install` command writes generic loading guidance without scanning packages. See [Trust model](./trust-model) for the reasoning and lifecycle boundaries.

The allowlist permits packages, not individual skills. An entry containing `#` is invalid; use `intent.exclude` for skill-specific filtering.

### Source entries

Each array entry names one source:

| Entry | Kind | Meaning |
| ----- | ---- | ------- |
| `@scope/pkg` or `pkg` | npm | An npm package reachable through the dependency tree, direct or transitive. |
| `workspace:@scope/pkg` | workspace | A package in the current workspace. |
| `@scope/*` | npm | Every discovered npm package whose name matches the pattern. |
| `workspace:@scope/*` | workspace | Every discovered workspace package whose name matches the pattern. |
| `git:<host>/<repo>#<ref>` | git | Reserved. Not yet supported, and rejected until a future version adds it. |

A malformed entry fails the whole command, and every bad entry is reported at once. Package patterns support `*` wildcards, including scoped patterns such as `@tanstack/*`. Intent matches both the package name and source kind: a bare entry permits only an npm source, and a `workspace:` entry permits only a workspace source.

### Special forms

The list as a whole has three special forms:

- **Absent.** No `intent.skills` key. Every discovered package is surfaced, and Intent prints a deprecation notice to stderr on each run until you set `intent.skills`. This is the upgrade path for existing projects. A future version will require an explicit allowlist.
- **Empty.** `"skills": []`. No package is surfaced. Intent prints an info notice to stderr.
- **Wildcard.** `"skills": ["*"]`. Every discovered package is surfaced. Unlike a package pattern such as `@tanstack/*`, this exact entry crosses package scopes and source kinds. Intent prints an acknowledged-risk notice to stderr, since unvetted skills may reach your agent.

A package that ships skills but is not listed is dropped. In human output, Intent adds one policy notice naming packages dropped this way so you can opt in. Agent sessions receive only the hidden package and skill counts. A listed package that was not discovered is reported as a notice as well.

### Existing projects

A project that has not set `intent.skills` keeps working. Intent surfaces every discovered package and prints the deprecation notice described under the absent form. Nothing breaks. Add an allowlist when you are ready, before a future version requires one. Run `intent list` to confirm which packages are surfaced.

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
