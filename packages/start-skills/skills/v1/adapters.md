---
id: adapters
title: Start Adapters
versions:
  - latest
  - ">=1 <2"
summary: Choose and configure Start adapters for the target runtime.
resources:
  - https://tanstack.com/start/latest/docs/overview
---

# Start Adapters

Purpose:

- Select the correct adapter for Node, edge, or serverless hosting.

Scope:

- Use when deploying or changing hosting providers.

Guidelines:

- Match adapter capabilities to deployment constraints (streaming, headers, cookies).
- Keep adapter-specific code isolated from shared app logic.
- Validate server-only dependencies work in the chosen runtime.
