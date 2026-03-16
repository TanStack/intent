---
'@tanstack/intent': patch
---

Fix monorepo workspace detection so `setup-github-actions`, `validate`, and `stale` behave correctly from repo roots and package directories. Generated workflows now derive skill and watch globs from actual workspace config, including `pnpm-workspace.yaml`, `package.json` workspaces, and Deno workspace files, which avoids broken paths, wrong labels, and false packaging warnings in non-`packages/*` layouts.
