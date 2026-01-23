---
id: render-optimizations
title: Render Optimizations
versions:
  - latest
  - ">=1 <2"
summary: Reduce rerenders and keep navigation smooth.
resources:
  - https://tanstack.com/router/latest/docs/framework/react/guide/render-optimizations
---

# Render Optimizations

Purpose:

- Reduce rerenders and keep navigation smooth.

Scope:

- Use when complex UIs re-render during navigation.

Guidelines:

- Prefer route-scoped hooks to avoid global rerenders.
- Avoid heavy computation in route components.
- Memoize derived UI from router state when needed.

Examples:

```ts
const isLoading = useRouterState({
  select: (state) => state.isLoading,
})
```

```tsx
const Sidebar = memo(SidebarImpl)
```
