---
'@tanstack/intent': patch
---

Add compact skill mappings and runtime resolution for agent config setup.

`intent install` now writes verified `intent-skills` blocks with compact `when`/`use` entries instead of embedding `load` paths. This keeps generated config portable across npm, pnpm, Bun, and Deno node_modules layouts, including transitive/package-manager-internal installs.

Add `intent resolve <package>#<skill>` to resolve compact mappings to the installed skill path at runtime, with `--json`, `--global`, and `--global-only` support. `intent list`, `intent install`, and `intent resolve` now scan local project packages by default and require explicit global flags for global package scanning.
