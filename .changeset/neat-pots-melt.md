---
'@tanstack/intent': patch
---

Make `scanForIntents` and `scanLibrary` synchronous instead of returning Promises for purely synchronous work. Clean up unnecessary async/await throughout source and tests, extract DRY test helpers, and improve type narrowing.
