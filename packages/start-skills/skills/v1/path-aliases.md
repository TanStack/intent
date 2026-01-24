---
id: path-aliases
title: Path Aliases
versions:
  - latest
summary: Configure path aliases for Start projects.
resources:
  - https://tanstack.com/start/latest/docs/overview
---

# Path Aliases

Purpose:

- Simplify imports across shared client and server code.

Scope:

- Use when standardizing module resolution.

Guidelines:

- Keep aliases consistent across tooling and the adapter runtime.
- Avoid aliasing server-only modules into client bundles.
- Document shared aliases for the team.

Examples:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@shared/*": ["shared/*"]
    }
  }
}
```
