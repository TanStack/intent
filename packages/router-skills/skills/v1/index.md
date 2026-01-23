---
id: router-index
title: Router Skill Index
versions:
  - latest
  - ">=1 <2"
summary: Choose the right Router skill based on the task at hand.
api:
  - https://tanstack.com/router/latest/docs/guide/overview
---

# Router Skill Index

Purpose:

- Help pick the right Router skill quickly.

Scope:

- Applies to any adapter and routing style.
- Routes to focused skills for routing, search, data loading, and errors.

How to pick a skill:

- Defining the overall route hierarchy, parent/child relationships, or nested shells -> `@skills/router/route-trees`
- Creating a shared UI shell (nav, sidebar, tabs) across child routes -> `@skills/router/layouts`
- Stabilizing references when paths change or you need stable route identifiers -> `@skills/router/route-ids`
- Reading path params like `$projectId` or using them in loaders/components -> `@skills/router/params`
- Validating search params with schemas or adapters -> `@skills/router/search-validation`
- Setting defaults for search params or keeping URL state stable -> `@skills/router/search-defaults`
- Fetching route-critical data before render -> `@skills/router/loaders`
- Passing dependencies like API clients/query clients to loaders -> `@skills/router/route-context`
- Warming data before navigation or hover -> `@skills/router/prefetching`
- Handling loader/render errors with dedicated UI -> `@skills/router/error-boundaries`
- Handling missing data or unmatched routes -> `@skills/router/not-found-boundaries`
- Choosing file-based routing or organizing routes by files -> `@skills/router/file-based-routing`
- Adding typed, declarative navigation links -> `@skills/router/links`
- Navigating programmatically after a submit or action -> `@skills/router/navigation`
- Showing pending UI or transition state -> `@skills/router/router-state`
- Ensuring loader data is serializable for SSR -> `@skills/router/ssr-loaders`

Next:

- After picking a skill, follow its API links and guidance.
