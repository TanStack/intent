---
'@tanstack/intent': minor
---

`maintainer setup` registers existing package-owned skills found under `skills/` directories that the skill tree does not record yet. Skill contents are preserved; the domain comes from `metadata.domain`, the domain map, or the parent directory, and defaults to `uncategorized` for the maintainer to edit. Invalid or conflicting skills are reported and left unregistered. Agent skill directories, dependencies, and packages outside the workspace are not scanned.
