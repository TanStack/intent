---
id: link-options
title: Link Options
versions:
  - latest
  - ">=1 <2"
summary: Control link behavior, active matching, and preloading.
resources:
  - https://tanstack.com/router/latest/docs/framework/react/guide/link-options
  - https://tanstack.com/router/latest/docs/framework/react/guide/linking
---

# Link Options

Purpose:

- Control link behavior, active matching, and preloading.

Scope:

- Use when configuring link behavior beyond defaults.

Guidelines:

- Set active options to control match sensitivity.
- Use preload options for responsive navigation.
- Keep replace/state/hash consistent with UX intent.

Examples:

```tsx
<Link to="/projects" activeOptions={{ exact: true }} />
```

```tsx
<Link to="/projects" preload="intent" />
```
