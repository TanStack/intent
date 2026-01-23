---
id: links
title: Links
versions:
  - latest
  - ">=1 <2"
summary: Build typed links, active states, and custom link components.
resources:
  - https://tanstack.com/router/latest/docs/guide/linking
  - https://tanstack.com/router/latest/docs/api/router/link
  - https://tanstack.com/router/latest/docs/api/router/use-link-props
---

# Links

Purpose:

- Navigate declaratively with typed links and shared link behavior.

Scope:

- Use for anchor-style navigation, active link styling, and custom link wrappers.

Guidelines:

- Prefer `Link` for navigation over manual anchors.
- Pass params and search through link props.
- Use active/pending link states for UI feedback.
- Use `useLinkProps` when building design-system links.

Examples:

```tsx
<Link to="/projects/$projectId" params={{ projectId }} />
```

```tsx
<Link to="/projects" search={{ page: 2 }} />
```

```tsx
<Link to="/projects" activeProps={{ className: "is-active" }} />
```

```tsx
const linkProps = useLinkProps({ to: "/projects" })
```
