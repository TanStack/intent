---
'@tanstack/intent': patch
---

Spawn the TypeScript 7 `tsgo` compiler process from the parent directory in `withNativeCompiler` while keeping `--cwd` set to the project root, so Windows callers can remove or rename the checked directory immediately after `intent validate` or `intent repair` without hitting `EPERM`.
