---
'@tanstack/intent': patch
---

Fix CLI silently doing nothing when run via `npx` due to symlink path mismatch in the `isMain` entry-point guard. Add workspace-aware scanning so `intent list` discovers skills in monorepo workspace packages when run from the monorepo root. Replace `resolveDepDir` with `createRequire`-based resolution that handles hoisted deps, pnpm symlinks, and export maps. The `resolveDepDir` public API signature changed from 4 parameters to 2 — callers using the old signature should update to `resolveDepDir(depName, parentDir)`.
