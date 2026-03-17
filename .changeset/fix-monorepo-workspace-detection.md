---
'@tanstack/intent': patch
---

Fix monorepo workspace detection so `setup-github-actions`, `validate`, `edit-package-json`, and `stale` behave correctly from repo roots and package directories. Resolve workspace packages using recursive glob matching, which supports nested patterns like `apps/*/packages/*`. Generated workflows now derive skill and watch globs from actual workspace config, including `pnpm-workspace.yaml`, `package.json` workspaces, and Deno workspace files, which avoids broken paths, wrong labels, and false packaging warnings in non-standard layouts.
