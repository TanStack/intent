---
'@tanstack/intent': patch
---

Stop shipping a type declaration file for the CLI entry. Nothing could import `dist/cli.d.mts`, so the installed package is 2,655 bytes smaller. The types for `@tanstack/intent` and `@tanstack/intent/core` do not change.
