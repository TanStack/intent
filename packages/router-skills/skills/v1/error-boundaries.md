---
id: error-boundaries
title: Error and Not-Found Boundaries
versions:
  - latest
  - ">=1 <2"
summary: Localize route errors with error boundaries.
resources:
  - https://tanstack.com/router/latest/docs/guide/error-handling
  - https://tanstack.com/router/latest/docs/api/router/create-route
---

# Error Boundaries

Purpose:

- Provide resilient UX for loader and render errors.

Scope:

- Use when setting per-route error UI.

Guidelines:

- Define boundaries close to where errors occur.
- Keep error UI consistent within a layout.

Examples:

- Route-specific boundary:
  ```ts
  const route = createRoute({
    getParentRoute: () => rootRoute,
    path: "projects/$projectId",
    errorComponent: ProjectError,
  })
  ```

- Layout-level boundary:
  ```ts
  const layoutRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "app",
    errorComponent: AppError,
  })
  ```
