---
'@tanstack/intent': patch
---

Fix scanner to discover transitive dependencies with skills in non-hoisted layouts (pnpm). Add dependency tree walking via `resolveDepDir` that resolves packages through the pnpm virtual store. Also handle shim import errors gracefully when `@tanstack/intent` is not installed, and use `@latest` in all npx commands to avoid local binary conflicts.
