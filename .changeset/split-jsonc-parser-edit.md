---
'@tanstack/intent': patch
---

Keep `jsonc-parser`'s editing and formatting modules out of the shared `project-context` chunk so read-only commands (`intent list`, `intent load`, `intent stale`, and `intent validate`) do not load JSONC edit and format code on startup; behavior does not change.
