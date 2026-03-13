---
'@tanstack/intent': patch
---

Fix CLI silently doing nothing when run via `npx` due to symlink path mismatch in the `isMain` entry-point guard. Also fix 3 pre-existing test failures on macOS caused by `/var` → `/private/var` symlink divergence.
