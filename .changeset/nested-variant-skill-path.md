---
'@tanstack/intent': patch
---

Point a skill from a nested dependency copy at that copy. When a workspace package installed its own version of a package, such as `packages/a/node_modules/foo`, and the root had a different copy at `node_modules/foo`, `list` showed the nested skill but `load` reported its path as `node_modules/foo/...`. Loading then failed with `Resolved skill file was not found`, or read the root copy's file instead. Intent now uses `node_modules/<name>/...` only when that entry is the same copy, and otherwise reports a project-relative path such as `packages/a/node_modules/foo/skills/core/SKILL.md`. pnpm and bun direct dependencies keep their stable `node_modules/<name>/...` paths.
