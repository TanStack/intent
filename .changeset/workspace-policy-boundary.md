---
'@tanstack/intent': patch
---

Reject unreadable and malformed ancestor package manifests while discovering workspace policy, so a nested application's allowlist cannot bypass inherited restrictions when the workspace root is unreadable. Stop ancestor discovery at the first workspace declaration or Git repository boundary, checking that directory's manifest before stopping. Without an independent boundary, malformed ancestors fail closed and identify the file to repair.
