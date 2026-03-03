# @tanstack/intent

## 0.1.0

### Patch Changes

- Add `intent-library` end-user CLI for library consumers. Libraries wire it up via a generated shim (`intent setup --shim`) to expose an `intent` bin. Running `intent list` recursively discovers skills across the library's dependency tree; `intent install` prints an agent-driven prompt to map skills to project tasks in CLAUDE.md. ([#9](https://github.com/TanStack/intent/pull/9))
