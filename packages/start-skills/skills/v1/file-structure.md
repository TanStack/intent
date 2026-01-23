---
id: file-structure
title: Start File Structure
versions:
  - latest
  - ">=1 <2"
summary: Organize Start entry points, routes, and shared modules.
resources:
  - https://tanstack.com/start/latest/docs/overview
---

# Start File Structure

Purpose:

- Clarify where Start expects app entry points, routes, and server-only modules.

Scope:

- Use when setting up a new app or refactoring structure.

Guidelines:

- Keep entry files and route modules minimal and focused.
- Separate shared utilities, server-only helpers, and client-only components.
- Use `@skills/router/file-based-routing` if you lean on Router file routing.
