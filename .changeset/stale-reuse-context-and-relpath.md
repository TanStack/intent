---
'@tanstack/intent': patch
---

Make `intent stale` reuse its per-run filesystem cache across target discovery, workspace enumeration, and skill-policy filtering, and compute each package's relative path to `_artifacts` once per package instead of once per artifact entry; behavior does not change.
