---
'@tanstack/intent': patch
---

Make `edit-package-json` and `add-library-bin` monorepo-aware: when run from a monorepo root, they discover workspace packages containing SKILL.md files and apply changes to each package's package.json. Also improve domain-discovery skill to read in-repo docs before interviewing and avoid asking factual questions the agent can answer by searching the codebase.
