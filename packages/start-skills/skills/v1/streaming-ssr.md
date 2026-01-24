---
id: streaming-ssr
title: Streaming SSR
versions:
  - latest
summary: Configure streaming SSR, suspense boundaries, and serialization.
resources:
  - https://tanstack.com/start/latest/docs/overview
---

# Streaming SSR

Purpose:

- Deliver fast, streaming responses with progressive hydration.

Scope:

- Use when tuning render latency or adding suspense boundaries.

Guidelines:

- Ensure loader data is serializable with `@skills/router/ssr-loaders`.
- Split non-critical UI into suspense boundaries for streaming.
- Verify the adapter supports streaming responses.
