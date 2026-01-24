---
id: selective-ssr
title: Rendering Modes
versions:
  - latest
summary: Choose SSR, selective SSR, or SPA rendering.
resources:
  - https://tanstack.com/start/latest/docs/overview
---

# Rendering Modes

Purpose:

- Tune rendering behavior per route or app.

Scope:

- Use when mixing SSR and client-only routes.

Guidelines:

- Decide SSR strategy per route with `@skills/router/ssr-loaders`.
- Ensure SPA routes load data via `@skills/router/loaders`.
- Avoid server-only APIs in client-only render paths.
- Validate adapter support for partial SSR and SPA builds.
