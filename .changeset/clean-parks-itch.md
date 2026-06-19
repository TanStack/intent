---
'@tanstack/intent': minor
---

Add `intent validate --check` and `intent validate --fix` for mechanical `SKILL.md` frontmatter migrations.

`--check` reports pending migrations without writing files. `--fix` rewrites fixable `name` and metadata scalar migrations, then re-runs validation.
