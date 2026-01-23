---
id: file-based-routing
title: File-Based Routing
versions:
  - latest
  - ">=1 <2"
summary: Organize routes by files and colocate route modules.
resources:
  - https://tanstack.com/router/latest/docs/guide/file-based-routing
---

# File-Based Routing

Purpose:

- Organize routes with files and colocated route modules.

Scope:

- Use when adopting file-based routing in a new or existing app.

Guidelines:

- Group routes by feature to keep layouts and loaders close to UI.
- Keep route modules small and focused on a single path.
- Document file conventions to avoid routing drift.

Examples:

- File layout:
  ```text
  routes/
    _layout.tsx
    projects/
      $projectId.tsx
  ```
