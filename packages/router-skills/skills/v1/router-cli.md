---
id: router-cli
title: Router CLI
versions:
  - latest
  - ">=1 <2"
summary: Use the Router CLI to scaffold and generate routes.
resources:
  - https://tanstack.com/router/latest/docs/framework/react/installation/with-router-cli
---

# Router CLI

Purpose:

- Scaffold and generate routes with the Router CLI.

Scope:

- Use when initializing or updating file-based routes.

Guidelines:

- Run the CLI in the project root.
- Keep generated routes checked into source control.
- Regenerate after route file changes when required.

Examples:

```text
pnpm dlx @tanstack/router-cli@latest init
```

```text
pnpm tanstack-router generate
```
