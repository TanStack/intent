---
'@tanstack/intent': patch
---

Rewrite relative Markdown links in `intent load` output so referenced skill files resolve from the loaded skill location. This applies to normal output and JSON `content`, while `--path` remains unchanged.
