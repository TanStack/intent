---
'@tanstack/intent': patch
---

Add workspace-aware scanning so `intent list` discovers skills in monorepo workspace packages when run from the root. Replace `resolveDepDir` with `createRequire`-based resolution that handles hoisted deps, pnpm symlinks, and export maps. The `resolveDepDir` public API signature changed from 4 parameters to 2 — callers using the old signature should update to `resolveDepDir(depName, parentDir)`. `detectPackageManager` now checks workspace root for lockfiles when scanning from a subdir.
