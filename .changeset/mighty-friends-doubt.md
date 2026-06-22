---
'@tanstack/intent': patch
---

Add proactive skill catalogs to installed Intent hooks.

`intent hooks install` now installs session-start catalog hooks for supported agents alongside the existing edit gate. Agents see the allowed local Intent skills at session start, resume, clear, and compact where the agent supports those lifecycle events, then still need to run `intent load` before editing.

The generated hook loads the catalog through the Intent CLI with agent audience redaction instead of importing package code from the target repository.
