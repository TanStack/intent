---
id: scroll-restoration
title: Scroll Restoration
versions:
  - latest
  - ">=1 <2"
summary: Restore or manage scroll position between navigations.
resources:
  - https://tanstack.com/router/latest/docs/framework/react/guide/scroll-restoration
---

# Scroll Restoration

Purpose:

- Restore scroll position between navigations.

Scope:

- Use in long lists or pages with deep scroll.

Guidelines:

- Enable restoration for list/detail flows.
- Reset scroll on route changes when needed.
- Keep custom scroll containers in sync.

Examples:

```tsx
<ScrollRestoration />
```

```ts
router.options.scrollRestoration = true
```
