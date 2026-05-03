---
'@tanstack/intent': patch
---

Reduce repeated filesystem work during Intent CLI scans by sharing package.json/skill discovery caches across scan paths and de-duping package-root and node_modules scan attempts within a single scan. Debug output now includes package.json read/cache-hit counts.
