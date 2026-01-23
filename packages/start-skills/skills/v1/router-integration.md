---
id: router-integration
title: Start Router Integration
versions:
  - latest
  - ">=1 <2"
summary: Connect Start runtime concerns with TanStack Router setup.
resources:
  - https://tanstack.com/router/latest/docs/guide/overview
  - https://tanstack.com/start/latest/docs/overview
---

# Start Router Integration

Purpose:

- Tie Start application wiring to Router configuration and data loading.

Scope:

- Use when aligning Start server rendering with Router route trees and loaders.

Guidelines:

- Build the route tree and loaders with Router-first patterns.
- Use `@skills/router/loaders` for data that must load before render.
- Coordinate SSR requirements with `@skills/router/ssr-loaders`.
