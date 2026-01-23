---
id: document-head-management
title: Document Head Management
versions:
  - latest
  - ">=1 <2"
summary: Manage titles, meta tags, and head elements per route.
resources:
  - https://tanstack.com/router/latest/docs/framework/react/guide/document-head-management
---

# Document Head Management

Purpose:

- Manage titles, meta tags, and head elements per route.

Scope:

- Use when routes need SEO or social metadata.

Guidelines:

- Define head data close to the route.
- Keep metadata derived from loader data when possible.
- Avoid duplicating global tags per route.

Examples:

```ts
const route = createRoute({
  getParentRoute: () => rootRoute,
  path: "projects/$projectId",
  head: ({ loaderData }) => ({
    title: loaderData.project.name,
  }),
})
```

```ts
head: () => ({ meta: [{ name: "description", content: "Projects" }] })
```
