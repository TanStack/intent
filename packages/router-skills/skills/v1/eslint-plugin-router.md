---
id: eslint-plugin-router
title: ESLint Plugin Router
versions:
  - latest
  - ">=1 <2"
summary: Enforce Router conventions with ESLint rules.
resources:
  - https://tanstack.com/router/latest/docs/eslint/eslint-plugin-router
  - https://tanstack.com/router/latest/docs/eslint/create-route-property-order
---

# ESLint Plugin Router

Purpose:

- Enforce Router conventions and prevent common mistakes.

Scope:

- Use when standardizing route file structure.

Guidelines:

- Enable the Router ESLint plugin in shared configs.
- Use rule sets to keep route definitions consistent.
- Apply property ordering to improve readability.

Examples:

```json
{
  "plugins": ["@tanstack/router"],
  "rules": {
    "@tanstack/router/create-route-property-order": "error"
  }
}
```
