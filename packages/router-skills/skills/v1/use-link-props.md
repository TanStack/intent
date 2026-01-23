---
id: use-link-props
title: useLinkProps
versions:
  - latest
  - ">=1 <2"
summary: Build custom link components with typed props.
resources:
  - https://tanstack.com/router/latest/docs/guide/linking
  - https://tanstack.com/router/latest/docs/api/router/use-link-props
---

# useLinkProps

Purpose:

- Build custom link components with typed props.

Scope:

- Use when wrapping Link in a design system.

Guidelines:

- Pass route params and search through props.
- Forward the returned props to anchor elements.
- Preserve active and pending states.

Example:

```tsx
const linkProps = useLinkProps({ to: "/projects" })
```
