---
title: intent exclude
id: intent-exclude
---

`intent exclude` manages `package.json#intent.exclude` entries.

```bash
npx @tanstack/intent@latest exclude [list|add|remove] [pattern] [--json]
```

## Options

- `--json`: print the configured exclude patterns as JSON

## Actions

1. `list` (default): print current excludes
2. `add <pattern>`: append one exclude pattern
3. `remove <pattern>`: remove one exclude pattern

## Examples

```bash
npx @tanstack/intent@latest exclude
npx @tanstack/intent@latest exclude list --json
npx @tanstack/intent@latest exclude add @tanstack/router#experimental-*
npx @tanstack/intent@latest exclude remove @tanstack/router#experimental-*
```

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
