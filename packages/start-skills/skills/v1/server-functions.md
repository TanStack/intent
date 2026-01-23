---
id: server-functions
title: Start Server Functions
versions:
  - latest
  - ">=1 <2"
summary: Create typed server functions with secure inputs and outputs.
resources:
  - https://tanstack.com/start/latest/docs/overview
---

# Start Server Functions

Purpose:

- Implement server-only logic with typed boundaries.

Scope:

- Use for mutations, data fetching, or sensitive operations.

Guidelines:

- Validate inputs before executing server logic.
- Return serializable data for hydration and streaming.
- Coordinate cache invalidation with `@skills/router/data-refresh`.
