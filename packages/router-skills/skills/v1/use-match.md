---
id: use-match
title: useMatch
versions:
  - latest
  - ">=1 <2"
summary: Read the active route match and its params.
resources:
  - https://tanstack.com/router/latest/docs/guide/matching
  - https://tanstack.com/router/latest/docs/api/router/use-match
---

# useMatch

Purpose:

- Read the active route match and params.

Scope:

- Use when you need route metadata for the current match.

Guidelines:

- Match by route ID or path.
- Use matches to derive UI state.
- Avoid matching inside render loops.

Example:

```ts
const match = useMatch({ from: "projects/$projectId" })
```
