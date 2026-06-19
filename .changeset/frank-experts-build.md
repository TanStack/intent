---
'@tanstack/intent': patch
---

Make `SKILL.md` frontmatter spec-compliant. `name` must now be a spec-legal leaf segment matching its parent directory (lowercase letters, numbers, and hyphens; 64 characters max; no slashes), and the Intent-specific scalars `type`, `library`, `library_version`, and `framework` live under the `metadata` map. `intent validate` now errors on a slash/non-leaf `name`, a `name` with non-spec characters or over 64 characters, non-spec top-level scalar keys, and a non-string `metadata` map. Skill identity is derived from the directory path rather than the frontmatter `name`, and the `generate-skill` and `tree-generator` templates emit the new shape.
