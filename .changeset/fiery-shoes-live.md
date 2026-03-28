---
'@tanstack/intent': patch
---

- Fix workspace package discovery for nested glob patterns, including support for `*` and `**`. Workspace patterns and resolved package roots are now normalized, deduped, and sorted, and the shared resolver has been extracted for reuse by internal workspace scanning. ([#93](https://github.com/TanStack/intent/pull/93))

- Refactor @tanstack/intent to use a shared project context resolver for workspace and package detection. This fixes monorepo targeting bugs in validate and edit-package-json, including pnpm workspaces defined only by pnpm-workspace.yaml. ([#93](https://github.com/TanStack/intent/pull/93))

- Use stable `node_modules/<name>/...` paths for skill references instead of absolute filesystem paths containing package-manager-internal directories with version numbers. Paths no longer break when packages are updated. ([#94](https://github.com/TanStack/intent/pull/94))
