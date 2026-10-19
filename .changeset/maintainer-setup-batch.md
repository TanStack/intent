---
'@tanstack/intent': patch
---

Make `intent maintainer setup` faster when a repository already has skills. Discovery and registration now share package context, checked paths, and parsed `SKILL.md` frontmatter across the batch instead of repeating them per skill; behavior does not change.
