---
id: search-defaults
title: Search Defaults
versions:
  - latest
  - ">=1 <2"
summary: Define defaults for stable search state.
api:
  - https://tanstack.com/router/latest/docs/guide/search-params
---

# Search Defaults

Purpose:

- Keep search state stable with defaults.

Scope:

- Use when routes require optional search values.

Guidelines:

- Define defaults in the schema for consistent links.
- Avoid storing complex state in the URL.
- Keep defaults aligned with loader expectations.

Example:

```ts
const searchSchema = z.object({
  page: z.number().default(1),
})
```
