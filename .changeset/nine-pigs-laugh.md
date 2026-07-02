---
'@tanstack/intent': patch
---

Fix potential hangs on slow or large environments:

- Bound the npm registry staleness check with a request timeout so `intent list` and other staleness checks can't hang indefinitely on a slow or unreachable registry.
- Bound global package-manager detection with a command timeout so it can't hang indefinitely when the environment's global `node_modules` is slow to resolve.
- Avoid enumerating a workspace package's entire skill tree just to check whether it has any skills, reducing filesystem work in large monorepos.
