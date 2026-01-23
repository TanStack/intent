---
id: streaming-ssr
title: Start Streaming SSR
versions:
  - latest
  - ">=1 <2"
summary: Configure streaming SSR, suspense boundaries, and serialization.
resources:
  - https://tanstack.com/start/latest/docs/overview
---

# Start Streaming SSR

Purpose:

- Deliver fast, streaming responses with progressive hydration.

Scope:

- Use when tuning render latency or adding suspense boundaries.

Guidelines:

- Ensure loader data is serializable with `@skills/router/ssr-loaders`.
- Split non-critical UI into suspense boundaries for streaming.
- Verify the adapter supports streaming responses.
