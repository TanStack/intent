---
title: Configuration
id: configuration
---

Configure Intent in the `intent` object in `package.json`:

- **`skills`** permits packages or individual skills.
- **`exclude`** blocks packages or skills after permissions are evaluated.

```json
{
  "intent": {
    "skills": [
      "@tanstack/query",
      "@acme/*",
      "@tanstack/start#routing",
      "workspace:@scope/internal"
    ],
    "exclude": ["@tanstack/router#experimental-*"]
  }
}
```

## Configuration inheritance

| Key | Inheritance rule |
| --- | --- |
| `intent.skills` | Uses the nearest non-null declaration between the current directory and the workspace or project root. A nearer declaration replaces its parent; omitted or null values inherit. |
| `intent.exclude` | Combines arrays from the root through the current directory, then adds excludes passed by the caller. |

## `intent.skills`

`intent.skills` is a package-source and skill allowlist. A permitted package or skill can:

- Appear in `list` and `stale`.
- Resolve through `load`.
- Contribute mappings to `install --map`.

Default `install` helps configure permissions on first use. See [Existing projects](#existing-projects) for how it handles saved or inherited configuration, and [Trust model](./trust-model) for the trust boundaries.

Package selectors permit current and future skills in the package. Exact selectors use `<package>#<skill>` and permit only that skill. If both match, the package selector takes precedence. `intent.exclude` is applied afterward and can still block either choice.

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

#### Validation rules

- Exact selectors require a non-empty package name and a non-empty skill name without wildcards.
- Package patterns support `*`, including scoped patterns such as `@tanstack/*`. Patterns cannot be combined with an exact skill selector.
- Source kinds must match: bare selectors permit npm sources; `workspace:` selectors permit workspace sources.
- `git:` entries are rejected, including entries containing `#` for a Git ref.

A malformed entry fails the whole command. Intent reports every bad entry at once.

### Special forms

| Form | Result | Notice |
| --- | --- | --- |
| **Absent:** no effective `intent.skills` key | Discovery commands surface every discovered package as migration behavior. | Deprecation notice until you configure permissions. |
| **Empty:** `"skills": []` | Surfaces no packages. | Info notice on stderr. |
| **Wildcard:** `"skills": ["*"]` | Permits every discovered package across scopes and source kinds, broader than `@tanstack/*`. | Acknowledged-risk notice: unvetted skills may reach your agent. |

All policy notices go to stderr. Exclusions still apply to these forms.

#### Discovery notices

| Situation | Notice |
| --- | --- |
| Discovered package is not permitted | Human output names omitted packages in one notice. Agent sessions receive only hidden package and skill counts. |
| Configured package was not discovered | Reports that the package was not discovered. |
| Package was explicitly excluded | No unlisted-source notice. |

### Existing projects

Run `intent list` to see which packages the current policy surfaces.

| Current configuration | Default `intent install` behavior |
| --- | --- |
| Saved or inherited `intent.skills` | Updates guidance only. Keeps permissions unchanged and does not prompt. |
| No effective `intent.skills` | Starts interactive permission setup. Non-TTY execution fails without writes. |

First-run setup discovers candidates before policy filtering and shows their versions and descriptions. It previews the selected allowlist and nearest owning `package.json`, then requires confirmation before saving permissions and installing guidance.

- **Excluded candidates** stay visible in the overview but cannot be selected. Exclusions remain unchanged.
- **Package-wide choices** include current and future skills and remove redundant selected children. Exact choices permit only the named skill.
- **Allow-all** is offered separately after the overview and saves `["*"]` alone.
- **An empty selection** explicitly confirms disabling all skills with `[]`.
- **Empty or fully excluded discovery** writes nothing, so setup can be retried.

See [Default install](../cli/intent-install#default-install) for picker controls, previews, and cancellation behavior.

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

### Exclusion patterns

| Pattern | Excludes |
| --- | --- |
| `@scope/pkg` | The whole package. |
| `@scope/pkg#search-params` | One named skill. |
| `@scope/pkg#experimental-*` | Matching skills in one package. |
| `*#experimental-*` | Matching skills across packages. |
| `@scope/pkg#*` | The whole package, using the `#*` shortcut. |

Each segment supports exact names and `*` wildcards only. Excludes apply to both npm and workspace sources with matching names, regardless of source kind.
