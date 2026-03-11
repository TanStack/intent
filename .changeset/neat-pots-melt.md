---
'@tanstack/intent': patch
---

Make `scanForIntents` synchronous instead of returning a Promise for purely synchronous work. This aligns the exported API with its actual behavior and cleans up incorrect async usage in the package.
