---
id: links
title: Links
versions:
  - latest
  - ">=1 <2"
summary: Use typed links for declarative navigation.
resources:
  - https://tanstack.com/router/latest/docs/guide/linking
  - https://tanstack.com/router/latest/docs/api/router/link
---

# Links

Purpose:

- Navigate declaratively with typed links.

Scope:

- Use for anchor-style navigation between routes.

Guidelines:

- Prefer `Link` for navigation over manual anchors.
- Pass params and search through link props.
- Use active/pending link states for UI feedback.

Example:

```tsx
<Link to="/projects/$projectId" params={{ projectId }} />
```
