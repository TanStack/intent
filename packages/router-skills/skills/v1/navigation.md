---
id: navigation
title: Navigation
versions:
  - latest
  - ">=1 <2"
summary: Navigate imperatively when links are not enough.
resources:
  - https://tanstack.com/router/latest/docs/guide/navigation
  - https://tanstack.com/router/latest/docs/api/router/use-navigate
---

# Navigation

Purpose:

- Navigate programmatically on events or side effects.

Scope:

- Use when button clicks or flows need imperatively triggered navigation.

Guidelines:

- Prefer links for simple navigation.
- Keep navigation target typed and stable.
- Avoid triggering navigation during render.

Example:

```ts
const navigate = useNavigate()
navigate({ to: "/projects" })
```
