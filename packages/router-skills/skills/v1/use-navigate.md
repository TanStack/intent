---
id: use-navigate
title: useNavigate
versions:
  - latest
  - ">=1 <2"
summary: Imperatively navigate from events or effects.
resources:
  - https://tanstack.com/router/latest/docs/guide/navigation
  - https://tanstack.com/router/latest/docs/api/router/use-navigate
---

# useNavigate

Purpose:

- Imperatively navigate from events or effects.

Scope:

- Use when you need to redirect after actions or submissions.

Guidelines:

- Prefer links for simple navigation.
- Avoid navigation during render.
- Use `replace` for non-history transitions.

Example:

```ts
const navigate = useNavigate()
navigate({ to: "/projects" })
```
