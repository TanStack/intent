---
'@tanstack/intent': patch
---

Refactor package discovery into a dedicated registrar and dependency walker so project, workspace, and transitive dependencies are scanned consistently. Track local vs. global package sources and surface that in `intent list` via a `SOURCE` column. `intent stale` is now scoped to local and workspace packages; global packages are only included by `intent list` (which explicitly opts in). A new `scanForIntents` option `includeGlobal` controls global scanning for programmatic callers — this replaces the previous implicit behavior where setting `INTENT_GLOBAL_NODE_MODULES` caused all commands to scan globals.
