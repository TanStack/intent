---
'@tanstack/intent': patch
---

Allow workspace packages to register skills with the same name. `intent maintainer` commands failed with `Duplicate skill identity or path` in a monorepo where two packages each had, for example, a `getting-started` skill; a skill name is now unique within its owning package, a prerequisite name refers to a skill in the same package, and `maintainer remove <name>` accepts `--package <directory>` when more than one package registers the name.
