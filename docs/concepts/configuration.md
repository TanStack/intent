---
title: Configuration
id: configuration
---

Configure Intent in the `intent` object in `package.json`:

- **`skills`** permits packages or individual skills.
- **`exclude`** blocks packages or skills after permissions are evaluated.
- **`options`** records this project's choices for skills that declare options.

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
| `intent.options` | Merges each skill's choices from the root through the current directory. A nearer package replaces a single choice and inherits the rest. |

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
| Configured exact skill is not in its discovered package | Reports that the entry was not discovered. |
| Package was explicitly excluded | No unlisted-source notice. |

### Existing projects

Run `intent list` to see which packages the current policy surfaces.

| Current configuration | Default `intent install` behavior |
| --- | --- |
| Saved or inherited `intent.skills` | Updates guidance only. Keeps permissions unchanged and does not prompt. |
| No effective `intent.skills` | Starts interactive permission setup. Non-TTY execution fails without writes. |

First-run setup offers **Enable all**, **Choose packages or scopes**, and **Choose individual skills**, followed by one confirmation before saving to the nearest owning `package.json` and installing guidance.

- **Compact rules:** Enable all saves `"*"`; package choices save names such as `"@tanstack/ai"`; explicit scope choices save patterns such as `"@tanstack/*"`. These rules include future matching skills and packages. Individual choices save exact names such as `"@tanstack/ai#skill"`.
- **Optional skill review:** choose **Review individual skills** at confirmation, then pick which selected packages to inspect. Leave the list empty to keep all selected skills. Only those packages open individual skill lists; unchecking a skill covered by a broad rule adds an exclusion. Existing and inherited exclusions stay in force.
- **Changing instructions:** access choices do not record approval of specific content. Skills can change with dependency updates; update notifications are not available yet.
- **Empty selection:** explicitly confirms disabling all skills with `[]`. Empty or fully excluded discovery writes nothing, so setup can be retried.

For example, enabling a scope and unchecking one skill saves:

```json
{
  "intent": {
    "skills": ["@tanstack/*"],
    "exclude": ["@tanstack/ai#skill"]
  }
}
```

This permits matching npm packages, including future additions, except the excluded skill. Selecting several packages individually never silently expands to a scope rule.

See [Default install](../cli/intent-install#default-install) for picker controls and cancellation behavior.

### Suppressing notices temporarily

Use `--no-notices` to suppress non-critical notices on stderr for one run:

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

@tanstack/intent@latest list --no-notices
@tanstack/intent@latest install --map --no-notices

<!-- ::end:tabs -->

For CI or wrapper scripts, set `INTENT_NO_NOTICES=1` to suppress notices without changing command arguments.

Discovery and resolution warnings are separate from policy notices and are not suppressed by these options. The acknowledged-risk notice for `"skills": ["*"]` also remains visible when other notices are suppressed.

## `intent.exclude`

`intent.exclude` removes packages or individual skills after the allowlist resolves.

Use `intent exclude` to manage this list from the CLI:

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

```text
@tanstack/intent@latest exclude add @tanstack/router#experimental-*
@tanstack/intent@latest exclude remove @tanstack/router#experimental-*
@tanstack/intent@latest exclude list
```

<!-- ::end:tabs -->

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

## `intent.options`

Some skills give different guidance depending on choices your project has made, such as which framework it uses. A skill declares those choices in an `options.json` file beside its `SKILL.md`. `intent.options` records your project's answers, so every agent session loads the skill with the same choices.

```json
{
  "intent": {
    "options": {
      "@acme/client#setup": {
        "framework": "tanstack-start"
      }
    }
  }
}
```

Each key is a skill in `<package>#<skill>` form. Each value maps an option name to one of the choices the skill declares.

When a skill has an `options.json` file, `intent load` appends a `## Project options` section to its content. The section lists each recorded choice. For an option you have not recorded, it lists the skill's default with the question and the available choices:

```text
## Project options

Choices this project made for `@acme/client#setup`, from `intent.options` in `package.json`. Follow the guidance that matches them.

- framework: tanstack-start
- fragmentColocation: yes (default, not recorded). Set up fragment colocation? Choices: yes, no.
```

Intent reads `options.json` as data. It does not run code from the package. A skill without `options.json` loads unchanged, even when `intent.options` has an entry for it.

### Option warnings

`intent load` prints a warning on stderr and continues in these cases:

| Situation | Result |
| --- | --- |
| A recorded value is not one of the declared choices | The skill's default applies. |
| A recorded option is not declared by the skill | The entry is ignored. |
| The skill's `options.json` is invalid or links outside its package | The skill loads without the section. |

Maintainers can find the file format under [Options file](../cli/intent-validate#options-file).
