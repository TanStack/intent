---
id: view-transitions
title: View Transitions
versions:
  - latest
  - ">=1 <2"
summary: Add view transitions to route navigations.
resources:
  - https://tanstack.com/router/latest/docs/framework/react/examples/view-transitions
---

# View Transitions

Purpose:

- Add view transitions to route navigations.

Scope:

- Use when you want animated transitions between routes.

Guidelines:

- Keep transitions subtle to preserve UX.
- Avoid blocking navigation during long animations.
- Test transitions with pending UI states.

Examples:

```ts
document.startViewTransition(() => router.navigate({ to: "/projects" }))
```

```ts
const navigate = useNavigate()
document.startViewTransition(() => navigate({ to: "/projects" }))
```
