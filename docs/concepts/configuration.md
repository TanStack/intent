---
title: Configuration
id: configuration
---

Intent reads consumer configuration from the `intent` object in `package.json`. Two keys control which skills reach your agent: `skills` (the allowlist) and `exclude` (the blocklist).

```json
{
  "intent": {
    "skills": ["@tanstack/query", "workspace:@scope/internal"],
    "exclude": ["@tanstack/router#experimental-*"]
  }
}
```

Intent merges these keys from every `package.json` between the current working directory and the workspace or project root. A monorepo package inherits the root configuration and adds its own.

## `intent.skills`

`intent.skills` is the allowlist. Only packages it permits contribute skills to `list`, `load`, `install`, and `stale`. See [Trust model](./trust-model) for the reasoning.

### Source entries

Each array entry names one source:

| Entry | Kind | Meaning |
| ----- | ---- | ------- |
| `@scope/pkg` or `pkg` | npm | A package reachable through the dependency tree, direct or transitive. |
| `workspace:@scope/pkg` | workspace | A package in the current workspace. |
| `git:<host>/<repo>#<ref>` | git | Reserved. Not yet supported, and rejected until a future version adds it. |

A malformed entry fails the whole command, and every bad entry is reported at once. Intent currently matches an allowlist entry against a discovered package by name. This matching will tighten in a future version.

### Special forms

The list as a whole has three special forms:

- **Absent.** No `intent.skills` key. Every discovered package is surfaced, and Intent prints a deprecation notice to stderr on each run until you set `intent.skills`. This is the upgrade path for existing projects. A future version will require an explicit allowlist.
- **Empty.** `"skills": []`. No package is surfaced. Intent prints an info notice to stderr.
- **Wildcard.** `"skills": ["*"]`. Every discovered package is surfaced. Intent prints an acknowledged-risk notice to stderr, since unvetted skills may reach your agent.

A package that ships skills but is not listed is dropped. When packages are dropped this way, Intent prints one summary line naming them so you can opt in. A listed package that was not discovered is reported as well.

### Existing projects

A project that has not set `intent.skills` keeps working. Intent surfaces every discovered package and prints the deprecation notice described under the absent form. Nothing breaks. Add an allowlist when you are ready, before a future version requires one. Run `intent list` to confirm which packages are surfaced.

### Suppressing notices temporarily

Use `--no-notices` to suppress non-critical notices on stderr for one run:

```bash
npx @tanstack/intent@latest list --no-notices
npx @tanstack/intent@latest install --map --no-notices
```

For CI or wrapper scripts, set `INTENT_NO_NOTICES=1` to suppress notices without changing command arguments.

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

Only exact names and `*` wildcards are supported on each segment. Bare package-name patterns keep working unchanged. An excluded package does not trigger the unlisted-source warning, because an exclude is an explicit decision.
