---
id: custom-links
title: Custom Links
versions:
  - latest
  - ">=1 <2"
summary: Build design-system links on top of Router links.
resources:
  - https://tanstack.com/router/latest/docs/framework/react/guide/custom-link
  - https://tanstack.com/router/latest/docs/api/router/use-link-props
---

# Custom Links

Purpose:

- Build design-system links on top of Router links.

Scope:

- Use when standard Link does not match UI needs.

Guidelines:

- Use `useLinkProps` to generate typed props.
- Forward refs and props to the underlying anchor.
- Preserve active and pending states.

Examples:

```tsx
const props = useLinkProps({ to: "/projects" })
return <a {...props} className="btn" />
```

```tsx
function NavLink(props) {
  const linkProps = useLinkProps(props)
  return <a {...linkProps} />
}
```
