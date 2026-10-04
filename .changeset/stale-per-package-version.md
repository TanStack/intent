---
'@tanstack/intent': patch
---

Stop `intent stale` from reporting artifact library version drift for a skill whose `library_version` matches the current version of its own package. Monorepos that version packages independently no longer get this false warning, and a review signal raised by more than one artifact file now prints once in the text output.
