---
'@tanstack/intent': patch
---

Preserve backslash escapes in Markdown link destinations when `intent load` and `intent meta` rewrite relative paths on Windows. Previously an escaped character such as `\)` was normalized into a path separator.
