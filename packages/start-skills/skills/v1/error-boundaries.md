---
id: error-boundaries
title: Error Handling
versions:
  - latest
summary: Handle runtime and hydration errors safely.
resources:
  - https://tanstack.com/start/latest/docs/overview
---

# Error Handling

Purpose:

- Define how errors surface during server rendering and hydration.

Scope:

- Use when handling runtime failures and hydration mismatches.

Guidelines:

- Capture server errors in middleware or server functions.
- Use `@skills/router/error-boundaries` for route-level UI fallback.
- Pair 404 handling with `@skills/router/not-found-boundaries`.
- Ensure server-rendered data matches client expectations.
