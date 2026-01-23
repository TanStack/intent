---
id: matching-and-location
title: Matching and Location
versions:
  - latest
  - ">=1 <2"
summary: Read matches, route metadata, and the current location.
resources:
  - https://tanstack.com/router/latest/docs/guide/matching
  - https://tanstack.com/router/latest/docs/guide/location
  - https://tanstack.com/router/latest/docs/api/router/use-match
  - https://tanstack.com/router/latest/docs/api/router/use-matches
  - https://tanstack.com/router/latest/docs/api/router/use-location
---

# Matching and Location

Purpose:

- Read route matches, metadata, and the current location.

Scope:

- Use when UI depends on the active route tree or URL state.

Guidelines:

- Use `useMatch` for a single route and `useMatches` for all matches.
- Read location for pathname or hash-driven UI.
- Avoid heavy computation on every location change.

Examples:

```ts
const match = useMatch({ from: "projects/$projectId" })
```

```ts
const matches = useMatches()
```

```ts
const location = useLocation()
```
