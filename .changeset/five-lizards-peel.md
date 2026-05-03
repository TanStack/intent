---
'@tanstack/intent': patch
---

Add the `@tanstack/intent/core` entrypoint for programmatic skill discovery and loading.

`intent load` now uses the core APIs and a direct dependency fast path, avoiding broad workspace scans when a requested skill can be resolved from the target package. This significantly improves load performance, especially in large workspaces, while preserving markdown link rewriting, warnings, debug output, and existing CLI behavior.
