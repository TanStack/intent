---
'@tanstack/intent': patch
---

Tighten skill-source identity to `(kind, id)` instead of name alone: `workspace:foo` no longer authorizes an npm-installed `foo` (and vice versa) in `intent.skills`, the "declared but not discovered" notice, and skill loading via `intent load`.
