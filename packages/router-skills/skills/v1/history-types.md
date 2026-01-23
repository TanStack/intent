---
id: history-types
title: History Types
versions:
  - latest
  - ">=1 <2"
summary: Choose the right history implementation for your environment.
resources:
  - https://tanstack.com/router/latest/docs/framework/react/guide/history-types
---

# History Types

Purpose:

- Choose the right history implementation for your environment.

Scope:

- Use when targeting browser, memory, or hash routing.

Guidelines:

- Use browser history for normal web apps.
- Use memory history for tests or non-DOM environments.
- Use hash history when server configuration is limited.

Examples:

```ts
const history = createBrowserHistory()
```

```ts
const history = createMemoryHistory({ initialEntries: ["/"] })
```
