---
id: middleware
title: Start Middleware
versions:
  - latest
  - ">=1 <2"
summary: Add request/response middleware for authentication and headers.
resources:
  - https://tanstack.com/start/latest/docs/overview
---

# Start Middleware

Purpose:

- Centralize auth, logging, and request transforms.

Scope:

- Use for cross-cutting concerns across all routes and server functions.

Guidelines:

- Keep middleware side-effect free where possible.
- Avoid router-specific logic; delegate to `@skills/router/authenticated-routes`.
- Ensure middleware stays compatible with the chosen adapter runtime.
