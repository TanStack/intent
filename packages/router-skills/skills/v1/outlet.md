---
id: outlet
title: Outlet
versions:
  - latest
  - ">=1 <2"
summary: Render child routes inside a layout.
resources:
  - https://tanstack.com/router/latest/docs/guide/route-layouts
  - https://tanstack.com/router/latest/docs/api/router/outlet
---

# Outlet

Purpose:

- Render child routes inside a layout.

Scope:

- Use in layout components that wrap child routes.

Guidelines:

- Place Outlet where child content should render.
- Keep layout UI stable across children.
- Avoid conditional outlet rendering.

Example:

```tsx
return (
  <div>
    <Sidebar />
    <Outlet />
  </div>
)
```
