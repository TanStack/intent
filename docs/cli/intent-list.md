---
title: intent list
id: intent-list
---

`intent list` discovers skill-enabled packages and shows the skills available under the project's permissions and exclusions. It does not change permissions or write guidance.

```bash
npx @tanstack/intent@latest list [--json] [--debug] [--global] [--global-only] [--show-hidden] [--no-notices]
```

## Options

### Output

- `--json`: print structured skills, packages, and diagnostics instead of text output
- `--debug`: print discovery details to stderr, including scan counts and package.json reads
- `--show-hidden`: include a hidden-source summary in text output when run outside an agent session
- `--no-notices`: suppress non-critical notices in text mode; the notice for `intent.skills: ["*"]` remains visible

### Scan scope

- `--global`: include global packages after project packages
- `--global-only`: list global packages only

## Behavior

### Default list

Intent scans project and workspace dependencies, applies `package.json#intent.skills`, then removes packages and skills matched by `intent.exclude`. It uses project `node_modules` when available and Yarn's PnP API in PnP projects without usable `node_modules`.

Global packages are scanned only with `--global` or `--global-only`. When both local and global copies of a package are found, the local copy takes precedence. Version conflicts show the chosen package and other discovered versions and paths.

Run [intent install](./intent-install) to configure permissions on first use. Listing skills does not open the install picker.

### Which skills appear

The nearest configured `intent.skills` list applies, including inherited workspace permissions. Each entry enables a package, a package pattern, or one exact skill:

| Saved rule | Skills included | Includes future additions? |
| --- | --- | --- |
| `"*"` | All discovered npm and workspace sources. | All packages and skills. |
| `"@tanstack/query"` | All skills in that npm package. | New skills in the package. |
| `"@tanstack/*"` | All skills in matching npm packages. | New matching packages and skills. |
| `"@tanstack/query#fetching"` | The `fetching` skill in that package. | Only that skill name. |
| `"workspace:@scope/internal"` | All skills in that workspace package. | New skills in the package. |

Workspace patterns and individual skills also use the `workspace:` prefix, such as `workspace:@scope/*` and `workspace:@scope/internal#testing`. Package patterns support `*`; individual-skill entries require an exact package and skill name. Git sources are not supported.

- **No configured list:** all discovered sources appear, with a migration notice. This is the existing-project upgrade path; a future version will require explicit permissions.
- **An empty list (`[]`):** no sources are permitted, with an informational notice.
- **All sources (`["*"]`):** all discovered sources appear, with a notice that unvetted skills may enter agent guidance.

Permissions select sources and skill names. They do not freeze skill content when dependencies update. See [Configuration](../concepts/configuration) and [Trust model](../concepts/trust-model).

### Exclusions

`intent.exclude` takes precedence over permissions. Intent combines exclusions from package.json files between the workspace or project root and the current directory.

| Exclusion | Effect |
| --- | --- |
| `@tanstack/*devtools*` | Excludes matching packages. |
| `@tanstack/query#experimental-*` | Excludes matching skills in that package. |
| `*#experimental-*` | Excludes matching skills across packages. |
| `@tanstack/query#*` | Excludes the whole package. |

Only exact names and `*` wildcards are supported. Excluded packages do not trigger unlisted-source notices. Manage exclusions with [intent exclude](./intent-exclude).

### Hidden sources

Packages outside an explicit allowlist are omitted from the available catalog. In a human session, a policy notice names them; `--show-hidden` adds their names and skill counts to the text output. This does not enable them.

In agent sessions, hidden sources are reported by count only. `--show-hidden` cannot reveal their identities there; run it outside the agent session to review candidates. A configured package or package pattern that was not discovered also produces a notice.

## Default output

Text output includes:

- A summary with package and skill counts.
- A package table with `PACKAGE`, `SOURCE`, `VERSION`, and `SKILLS` columns.
- A skill tree grouped by package, with descriptions and commands to load each skill.
- Version conflicts and discovery warnings, when present.

Load commands use the detected package manager and preserve the selected global scan scope. `SOURCE` distinguishes local discovery from explicit global scanning.

Text output and discovery warnings go to stdout. Policy notices and `--debug` details go to stderr.

## JSON output

`--json` prints a structured catalog to stdout. This example shows one available skill with no hidden sources or diagnostics; paths and package metadata vary by project:

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
      "description": "Query data fetching patterns",
      "type": "core",
      "framework": "react"
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
  "hiddenSourceCount": 0,
  "hiddenSources": [],
  "warnings": [],
  "notices": [],
  "conflicts": []
}
```

| Field | Meaning |
| --- | --- |
| `skills` | Available skills. `use` is the portable `<package>#<skill>` identity; `type` and `framework` are optional. |
| `packages` | Selected packages, their source and location, and permitted skill counts. |
| `hiddenSourceCount` | Number of packages hidden by the explicit allowlist. |
| `hiddenSources` | Objects with `name` and `skillCount` in human sessions, even without `--show-hidden`. Always empty in agent sessions. |
| `warnings` | Discovery warnings. |
| `notices` | Policy and migration notices. `--no-notices` does not remove these from JSON. |
| `conflicts` | Objects with `packageName`, `chosen`, and `variants`. Each chosen or variant entry contains `version` and `packageRoot`. |

JSON includes diagnostics in the object instead of printing separate warning or notice blocks. `--debug` still writes to stderr. Treat identifiers as data when constructing commands; JSON does not contain shell-escaped arguments.

## Status messages

| Result | Message or behavior |
| --- | --- |
| No selected packages | `No intent-enabled packages found.` |
| Available catalog | `<package count> intent-enabled packages, <skill count> skills` followed by the table and tree. |
| Version conflicts | `Version conflicts:` followed by the chosen version and other discovered locations. |
| Hidden-source review | `Hidden skill sources:` followed by names and skill counts in a human session. |
| Hidden-source review in an agent session | `Hidden skill sources are not revealed in agent sessions. Run this command outside the agent session to review candidates.` |
| Discovery warnings | `Warnings:` followed by `⚠` messages on stdout in text mode. |
| Policy notices | `Notices:` followed by `ℹ` messages on stderr in text mode. |

## Common errors

- **Invalid permissions or unreadable policy files:** Intent stops and reports the problem. Fix the reported package.json or `intent.skills` entry before retrying.
- **Unsupported runnable identifier:** generated commands accept only ASCII letters, numbers, `_`, `.`, `/`, `@`, `#`, and `-`. Identifiers cannot start with `#`. Rename the package or skill to generate runnable guidance. `--json` can still expose permitted identifiers as data.
- **Unreadable or out-of-package skill metadata:** discovery skips skill files whose real path cannot be resolved or lies outside the package root, with a warning. Symlinks within the resolved package root remain supported. External frontmatter is not read into the catalog.
- **Deno without `node_modules`:** this discovery mode is unsupported.

## Related

- [intent install](./intent-install)
- [intent load](./intent-load)
- [intent exclude](./intent-exclude)
- [Configuration](../concepts/configuration)
- [Trust model](../concepts/trust-model)
