---
id: environment-config
title: Start Environment Config
versions:
  - latest
  - ">=1 <2"
summary: Manage environment variables and secrets for Start runtimes.
resources:
  - https://tanstack.com/start/latest/docs/overview
---

# Start Environment Config

Purpose:

- Keep secrets and runtime settings consistent across environments.

Scope:

- Use when wiring environment variables for adapters and server functions.

Guidelines:

- Validate required environment variables at startup.
- Keep secrets server-only and never expose them to client bundles.
- Coordinate per-environment overrides with the deployment target.
