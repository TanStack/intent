---
'@tanstack/intent': patch
---

Refactor @tanstack/intent to use a shared project context resolver for workspace and package detection. This fixes monorepo targeting bugs in validate and edit-package-json, including pnpm workspaces defined only by pnpm-workspace.yaml.
