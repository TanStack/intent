---
title: intent exclude
id: intent-exclude
---

`intent exclude` manages the `intent.exclude` list in your `package.json`. Excludes remove packages or individual skills after the `intent.skills` allowlist resolves, so an excluded skill never reaches your agent even when its package is trusted.

<!-- ::start:tabs variant="package-manager" mode="local-install" -->
@tanstack/intent@latest exclude [list|add|remove] [pattern] [--json]
<!-- ::end:tabs -->

## Actions

- `list` (default): print the configured excludes. Add `--json` for machine-readable output. Humans and agents may list policy.
- `add <pattern>`: append one exclude pattern. This is a user-owned policy change; agents pause and ask the user to run it.
- `remove <pattern>`: remove one exclude pattern. This is a user-owned policy change; agents pause and ask the user to run it.

```bash
npx @tanstack/intent@latest exclude
npx @tanstack/intent@latest exclude list --json
npx @tanstack/intent@latest exclude add @tanstack/router#experimental-*
npx @tanstack/intent@latest exclude remove @tanstack/router#experimental-*
```

For the pattern grammar - whole packages, single skills, and globs - see [Configuration](../concepts/configuration).

## Behavior

`add` and `remove` edit the project policy `package.json`, using the workspace root when one owns the current package. They create `intent.exclude` if it is missing and keep existing entries in order. Intent validates a pattern before writing and refuses an invalid `intent` or `intent.exclude` structure. `list` prints `Configured excludes:` with one entry per line, or `No excludes configured.` when the list is empty. `--json` is available only with `list`.

After a mutation, Intent immediately reconciles configured symlink delivery without prompting, so a newly excluded skill is no longer exposed through an existing managed link. Hook delivery reads policy dynamically and needs no reconciliation. `intent.lock` remains unchanged; removing an exclusion can restore content that the user previously accepted.

An excluded package does not trigger the unlisted-source warning, because excluding it is an explicit decision.

## Related

- [Configuration](../concepts/configuration) - the exclude pattern grammar.
- [`intent list`](./intent-list) - see what remains after excludes.
- [`intent load`](./intent-load) - excluded skills refuse to load.
