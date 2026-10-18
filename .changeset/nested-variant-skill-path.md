---
'@tanstack/intent': patch
---

Fix `intent load` for a skill that ships in a nested copy of a dependency. When a workspace package such as `packages/bar` installed its own version of `@tanstack/query`, and the root `node_modules/@tanstack/query` was a different copy, `list` showed the nested skill but `load` looked for it under `node_modules/@tanstack/query/...` and failed. Intent now uses the `node_modules/<name>/...` path only when that entry is the same copy. Otherwise it reports the project-relative path, such as `packages/bar/node_modules/@tanstack/query/skills/fetching/SKILL.md`. Hoisted installs and pnpm or bun symlinks to the same copy keep their `node_modules/<name>/...` paths.
