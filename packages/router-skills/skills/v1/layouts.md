---
id: layouts
title: Layout Routes
versions:
  - latest
  - ">=1 <2"
summary: Share UI shells, loaders, and boundaries across child routes.
resources:
  - https://tanstack.com/router/latest/docs/guide/route-trees
  - https://tanstack.com/router/latest/docs/guide/route-layouts
---

# Layout Routes

Purpose:

- Share UI shells, loaders, and boundaries across child routes.

Scope:

- Use when multiple routes need the same shell UI or shared data.

Guidelines:

- Place shared navigation and chrome on layout routes.
- Keep layout loaders limited to shared data.
- Use an outlet to render child routes inside the layout.
- Keep layouts stable to avoid remount churn.

Examples:

```ts
const layoutRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "app",
  component: AppLayout,
})
```

```tsx
function AppLayout() {
  return (
    <div>
      <Sidebar />
      <Outlet />
    </div>
  )
}
```
