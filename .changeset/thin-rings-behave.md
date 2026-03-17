---
'@tanstack/intent': patch
---

Refactored the CLI to use `cac`, replacing the previous hand-rolled parsing and dispatch logic with a more structured command system.

This update also fixes monorepo workflow generation behavior related to `setup-github-actions`, improving repo/package fallback handling and ensuring generated workflow watch paths are monorepo-aware.
