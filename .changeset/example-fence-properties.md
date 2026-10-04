---
'@tanstack/intent': patch
---

Add fence properties that control how `intent validate` checks one code example. `no-check` after the language skips a fragment that is not a complete source file. `expect-error` requires the example to report an error, and `expect-error=TS2322` requires that error code, so a deliberately wrong example fails validation once it compiles.
