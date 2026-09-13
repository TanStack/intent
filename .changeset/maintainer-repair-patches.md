---
'@tanstack/intent': patch
---

Add a lightweight `intent repair` command for unambiguous frontmatter migrations and reviewable before/after example patches. Preserve conflicting metadata and refuse alias edits that could change unrelated fields. Write mode applies only safe frontmatter changes; code-example suggestions require review and are emitted as patches without changing source files.
