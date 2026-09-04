---
title: Configuration
id: configuration
---

Intent reads consumer configuration from the `intent` object in `package.json`. Two keys control which discovered skills Intent surfaces: `skills` (the allowlist) and `exclude` (the blocklist).

```json
{
  "intent": {
    "skills": ["@tanstack/query", "@acme/*", "@tanstack/start#routing", "workspace:@scope/internal"],
    "exclude": ["@tanstack/router#experimental-*"]
  }
}
```

## Configuration inheritance

- **`intent.skills`:** Intent uses the nearest non-null declaration between the current working directory and the workspace or project root. A nearer declaration replaces its parent. An omitted or null value inherits the nearest parent declaration.
- **`intent.exclude`:** Intent combines arrays from the root through the current working directory, then adds excludes passed by the caller.

## `intent.skills`

`intent.skills` is a package-source and skill allowlist. A permitted package or skill can:

- Appear in `list` and `stale`.
- Resolve through `load`.
- Contribute mappings to `install --map`.

The default `install` command keeps guidance-only behavior when effective `intent.skills` is non-null. When no effective declaration exists, an interactive first run discovers raw npm and workspace candidates, previews the exact allowlist and nearest owning `package.json`, and requires confirmation before it writes permissions and guidance. Non-TTY first runs fail without writes. See [Trust model](./trust-model) for the reasoning and lifecycle boundaries.

Package selectors permit every skill in the package. Exact selectors use `<package>#<skill>` and permit only the named skill. If the same package matches both forms, the package selector takes precedence and permits every skill. `intent.exclude` is applied afterward and can still remove a permitted package or skill.

### Source entries

Each array entry names one source:

| Entry | Kind | Meaning |
| ----- | ---- | ------- |
| `@scope/pkg` or `pkg` | npm | An npm package reachable through the dependency tree, direct or transitive. |
| `@scope/pkg#skill` | npm | One exact skill in an npm package. |
| `workspace:@scope/pkg` | workspace | A package in the current workspace. |
| `workspace:@scope/pkg#skill` | workspace | One exact skill in a workspace package. |
| `@scope/*` | npm | Every discovered npm package whose name matches the pattern. |
| `workspace:@scope/*` | workspace | Every discovered workspace package whose name matches the pattern. |
| `git:<host>/<repo>#<ref>` | git | Reserved. Not yet supported, and rejected until a future version adds it. |

A malformed entry fails the whole command, and every bad entry is reported at once. Exact selectors require one non-empty package name and one non-empty, non-wildcard skill name. Package patterns support `*` wildcards, including scoped patterns such as `@tanstack/*`, but cannot be combined with an exact skill selector.

Intent matches both the package name and source kind: a bare package or exact selector permits only an npm source, and a `workspace:` selector permits only a workspace source. `git:` entries remain unsupported and are rejected, including entries that contain `#` for a Git ref.

### Special forms

| Form | Result | Notice |
| --- | --- | --- |
| **Absent:** no effective `intent.skills` key | `list`, `load`, and other discovery surfaces retain the existing upgrade path. Default `install` starts reviewed permission setup in a TTY and fails without writes outside a TTY. | Deprecation notice on stderr on discovery runs until you set `intent.skills`. |
| **Empty:** `"skills": []` | Surfaces no packages. | Info notice on stderr. |
| **Wildcard:** `"skills": ["*"]` | Surfaces every discovered package across package scopes and source kinds. This is broader than a pattern such as `@tanstack/*`. | Acknowledged-risk notice on stderr because unvetted skills may reach your agent. |

A package that ships skills but is not listed is dropped. In human output, Intent adds one policy notice naming packages dropped this way so you can opt in. Agent sessions receive only the hidden package and skill counts. A listed package that was not discovered is reported as a notice as well.

### Existing projects

Run `intent list` to see which packages the current policy surfaces.

A project without effective `intent.skills` uses the absent form: Intent surfaces every discovered package on existing discovery surfaces and prints its deprecation notice. Run `intent install` in an interactive terminal to choose package or exact-skill permissions and write them to the nearest `package.json` that owns the current working directory.

The first-run selector uses raw discovery before policy filtering. Existing `intent.exclude` entries remain unchanged and make matching candidates unavailable. Press Space to toggle package-wide or exact-skill entries and Enter to confirm. Selecting no entries writes `[]`. Allow-all is a separate choice and writes `["*"]` alone. A package-wide selection trusts every skill in that package and removes redundant selected children; an exact-only selection trusts only that skill. npm and `workspace:` source kinds remain distinct.

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
