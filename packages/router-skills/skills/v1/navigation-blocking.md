---
id: navigation-blocking
title: Navigation Blocking
versions:
  - latest
  - ">=1 <2"
summary: Block navigation when unsaved work is present.
resources:
  - https://tanstack.com/router/latest/docs/framework/react/guide/navigation-blocking
---

# Navigation Blocking

Purpose:

- Prevent navigation when there are unsaved changes.

Scope:

- Use in forms or editors with draft state.

Guidelines:

- Keep blocking logic scoped to the route or component.
- Provide clear confirmation UI for the user.
- Disable blocking after a successful save.

Examples:

```ts
const blocker = useBlocker({
  shouldBlockFn: () => hasUnsavedChanges,
})
```

```ts
blocker.reset()
```
