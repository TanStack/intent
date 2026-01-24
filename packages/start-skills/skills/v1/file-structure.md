---
id: file-structure
title: File Structure
versions:
  - latest
summary: Organize Start entry points, routes, and shared modules.
resources:
  - https://tanstack.com/start/latest/docs/overview
---

# File Structure

Purpose:

- Clarify where Start expects app entry points, routes, and server-only modules.

Scope:

- Use when setting up a new app or refactoring structure.

Guidelines:

- Keep entry files and route modules minimal and focused.
- Separate shared utilities, server-only helpers, and client-only components.
- Group runtime-only code (server functions, middleware, server routes) together.
- Use `@skills/router/file-based-routing` if you lean on Router file routing.

Examples:

```
app/
  routes/
    index.tsx
    settings.tsx
  entry-client.tsx
  entry-server.tsx
server/
  routes/
  middleware/
shared/
  formatting.ts
```
