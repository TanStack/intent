---
'@tanstack/intent': patch
---

Reduce repeated filesystem reads and path calculations in list, load, validate, and stale commands. Reuse command-scoped manifests, skill discovery, and shared workspace artifacts; index artifact matches once per package and batch workspace identity checks.
