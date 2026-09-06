---
title: intent exclude
id: intent-exclude
---

`intent exclude` manages `package.json#intent.exclude` entries.

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: @tanstack/intent@latest exclude [list|add|remove] [pattern] [--json]
solid: @tanstack/intent@latest exclude [list|add|remove] [pattern] [--json]
vue: @tanstack/intent@latest exclude [list|add|remove] [pattern] [--json]
svelte: @tanstack/intent@latest exclude [list|add|remove] [pattern] [--json]
angular: @tanstack/intent@latest exclude [list|add|remove] [pattern] [--json]
lit: @tanstack/intent@latest exclude [list|add|remove] [pattern] [--json]

<!-- ::end:tabs -->

## Options

- `--json`: print the configured exclude patterns as JSON

## Actions

1. `list` (default): print current excludes
2. `add <pattern>`: append one exclude pattern
3. `remove <pattern>`: remove one exclude pattern

## Examples

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: @tanstack/intent@latest exclude
react: @tanstack/intent@latest exclude list --json
react: `@tanstack/intent@latest exclude add @tanstack/router#experimental-*`
react: `@tanstack/intent@latest exclude remove @tanstack/router#experimental-*`
solid: @tanstack/intent@latest exclude
solid: @tanstack/intent@latest exclude list --json
solid: `@tanstack/intent@latest exclude add @tanstack/router#experimental-*`
solid: `@tanstack/intent@latest exclude remove @tanstack/router#experimental-*`
vue: @tanstack/intent@latest exclude
vue: @tanstack/intent@latest exclude list --json
vue: `@tanstack/intent@latest exclude add @tanstack/router#experimental-*`
vue: `@tanstack/intent@latest exclude remove @tanstack/router#experimental-*`
svelte: @tanstack/intent@latest exclude
svelte: @tanstack/intent@latest exclude list --json
svelte: `@tanstack/intent@latest exclude add @tanstack/router#experimental-*`
svelte: `@tanstack/intent@latest exclude remove @tanstack/router#experimental-*`
angular: @tanstack/intent@latest exclude
angular: @tanstack/intent@latest exclude list --json
angular: `@tanstack/intent@latest exclude add @tanstack/router#experimental-*`
angular: `@tanstack/intent@latest exclude remove @tanstack/router#experimental-*`
lit: @tanstack/intent@latest exclude
lit: @tanstack/intent@latest exclude list --json
lit: `@tanstack/intent@latest exclude add @tanstack/router#experimental-*`
lit: `@tanstack/intent@latest exclude remove @tanstack/router#experimental-*`

<!-- ::end:tabs -->

## Behavior

- Reads and writes the current working directory `package.json`
- Creates `intent.exclude` when missing
- Keeps existing excludes and appends new patterns in order
- Validates pattern syntax before writing
- Refuses invalid `package.json` structures for `intent` and `intent.exclude`

## Related

- [Configuration](../concepts/configuration)
- [intent list](./intent-list)
- [intent load](./intent-load)
