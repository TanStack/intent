---
id: server-routes
title: Server Routes
versions:
  - latest
summary: Add server routes outside the Router UI.
resources:
  - https://tanstack.com/start/latest/docs/overview
---

# Server Routes

Purpose:

- Build server-only endpoints for APIs or webhooks.

Scope:

- Use when you need endpoints not tied to UI routes.

Guidelines:

- Keep UI routing in `@skills/router/route-trees`.
- Use server routes for webhooks, callbacks, or internal APIs.
- Protect server routes with middleware and auth checks.

Examples:

```ts
export const webhook = defineServerRoute({
  method: 'POST',
  handler: async (request) => {
    await verifySignature(request)
    return new Response('ok')
  },
})
```
