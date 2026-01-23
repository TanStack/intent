---
id: error-boundaries
title: Error and Not-Found Boundaries
versions:
  - latest
  - ">=1 <2"
summary: Localize route errors and missing data with boundaries.
api:
  - https://tanstack.com/router/latest/docs/guide/error-handling
  - https://tanstack.com/router/latest/docs/api/router/create-route
---

# Error and Not-Found Boundaries

Purpose:

- Provide resilient UX for loader errors and unknown routes.

Scope:

- Use when setting per-route error or not-found UI.

Guidelines:

- Define boundaries close to where errors occur.
- Use not-found boundaries for missing data or routes.
- Keep error UI consistent within a layout.

Examples:

- Route-specific boundaries:
  ```ts
  const route = createRoute({
    getParentRoute: () => rootRoute,
    path: "projects/$projectId",
    errorComponent: ProjectError,
    notFoundComponent: ProjectNotFound,
  })
  ```
