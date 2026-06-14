---
'@tanstack/intent': minor
---

Add `package.json#intent.skills` source allowlisting to gate which discovered packages can contribute skills.

`intent.exclude` now supports skill-level matching (for example `@scope/pkg#skill-id` and globs), and policy filtering is applied consistently across `intent list`, `intent load`, `intent install`, and `intent stale`. Notices are surfaced separately from warnings to keep command output machine-safe.
