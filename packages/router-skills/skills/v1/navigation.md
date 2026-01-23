---
id: navigation
title: Navigation
versions:
  - latest
  - ">=1 <2"
summary: Navigate imperatively with hooks and options.
resources:
  - https://tanstack.com/router/latest/docs/guide/navigation
  - https://tanstack.com/router/latest/docs/api/router/use-navigate
  - https://tanstack.com/router/latest/docs/api/router/navigate
---

# Navigation

Purpose:

- Navigate programmatically on events or side effects.

Scope:

- Use when button clicks or flows need imperatively triggered navigation.

Guidelines:

- Prefer links for simple navigation.
- Keep navigation targets typed and stable.
- Avoid triggering navigation during render.
- Use `replace` for non-history transitions.
- Pass `state` for transient UI intent.

Examples:

```ts
const navigate = useNavigate()
navigate({ to: "/projects" })
```

```ts
navigate({ to: "/projects", replace: true })
```

```ts
navigate({ to: "/projects", state: { from: "create" } })
```
