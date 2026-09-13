---
'@tanstack/intent': patch
---

Speed up dependency discovery. Resolve each dependency directory with a plain `node_modules` walk plus a single symlink collapse instead of Node's module resolver, which evaluated export maps and realpathed every path segment per lookup, and resolve each package's real root once per package instead of once per skill. `intent list` in a pnpm monorepo runs roughly 30% faster; discovered packages and paths are unchanged.
