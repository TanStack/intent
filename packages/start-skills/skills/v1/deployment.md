---
id: deployment
title: Deployment
versions:
  - latest
summary: Deploy Start apps to hosting targets.
resources:
  - https://tanstack.com/start/latest/docs/overview
---

# Deployment

Purpose:

- Ship Start apps with predictable builds and runtime behavior.

Scope:

- Use when targeting a new hosting provider or build pipeline.

Guidelines:

- Confirm adapter compatibility with the hosting provider.
- Validate SSR requirements with `@skills/router/ssr-loaders`.
- Ensure server functions are deployed to the correct runtime.
