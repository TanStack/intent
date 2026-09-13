---
'@tanstack/intent': patch
---

Keep Markdown link destinations that contain a private-use character (U+E000) intact when `intent load` and `intent meta` rewrite relative paths; the escape placeholder is now chosen so it never collides with the destination's own characters.
