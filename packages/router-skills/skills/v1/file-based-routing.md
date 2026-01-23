---
id: file-based-routing
title: File-Based Routing
versions:
  - latest
  - ">=1 <2"
summary: Organize routes by files, layouts, and route groups.
resources:
  - https://tanstack.com/router/latest/docs/guide/file-based-routing
---

# File-Based Routing

Purpose:

- Organize routes with files, layouts, and route groups.

Scope:

- Use when adopting file-based routing in a new or existing app.

Guidelines:

- Group routes by feature to keep layouts and loaders close to UI.
- Use layout files for shared shells.
- Use index files for default child routes.
- Use `$param` filenames for dynamic segments.
- Use route groups for structure without URL changes.
- Document file conventions to avoid routing drift.

Examples:

```text
routes/
  _layout.tsx
  projects/
    index.tsx
    $projectId.tsx
```

```text
routes/
  (admin)/
    users.tsx
```
