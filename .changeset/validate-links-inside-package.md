---
'@tanstack/intent': patch
---

`validate` reports an error when a relative Markdown link in a `SKILL.md` resolves to a path outside the package that owns the skill, even when the target exists in the repository. Only the package is installed in a consumer project, so such a link is dead for every consumer.
