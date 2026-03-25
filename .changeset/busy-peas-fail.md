---
'@tanstack/intent': patch
---

Fix workspace package discovery for nested glob patterns, including support for `*` and `**`. Workspace patterns and resolved package roots are now normalized, deduped, and sorted, and the shared resolver has been extracted for reuse by internal workspace scanning.
