---
'@tanstack/intent': patch
---

Fix transitive skill discovery under pnpm's isolated linker. Skills shipped by a transitive dependency of a skill-bearing direct dependency were not discovered… Each package's dependencies are now resolved from its realpath, where pnpm resolution succeeds. Hoisted (npm/yarn/bun) layouts are unaffected.
