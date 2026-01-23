---
id: router-index
title: Router Skill Index
versions:
  - latest
  - ">=1 <2"
summary: Choose the right Router skill based on the task at hand.
resources:
  - https://tanstack.com/router/latest/docs/guide/overview
---

# Router Skill Index

Purpose:

- Help pick the right Router skill quickly.

Scope:

- Applies to any adapter and routing style.
- Routes to focused skills for routing, search, data loading, and errors.

How to pick a skill:

Core setup and structure:

- Creating and mounting the router -> `@skills/router/router-setup`
- Defining the overall route hierarchy -> `@skills/router/route-trees`
- Creating a shared UI shell across child routes -> `@skills/router/layouts`
- Stabilizing references when paths change -> `@skills/router/route-ids`
- Attaching route metadata for UI or analytics -> `@skills/router/route-meta`

Routing params and search:

- Reading path params and splats -> `@skills/router/params`
- Validating, defaulting, and reading search params -> `@skills/router/search-params`

Data loading and refresh:

- Fetching route-critical data before render -> `@skills/router/loaders`
- Passing dependencies like API clients to loaders -> `@skills/router/route-context`
- Prefetching and invalidating after mutations -> `@skills/router/data-refresh`

Navigation and links:

- Adding typed, declarative navigation links -> `@skills/router/links`
- Navigating programmatically after actions -> `@skills/router/navigation`

Matching and router state:

- Reading matches and the current location -> `@skills/router/matching-and-location`
- Showing pending UI or transition state -> `@skills/router/router-state`

Errors, redirects, and masking:

- Handling loader/render errors -> `@skills/router/error-boundaries`
- Handling missing data or unmatched routes -> `@skills/router/not-found-boundaries`
- Redirecting from loaders/actions -> `@skills/router/redirects`
- Presenting friendly URLs for internal routes -> `@skills/router/route-masking`

File-based routing:

- Choosing file-based routing or organizing routes by files -> `@skills/router/file-based-routing`

Rendering and runtime:

- Ensuring loader data is serializable for SSR -> `@skills/router/ssr-loaders`
- Lazy-loading route modules for code-splitting -> `@skills/router/route-lazy-loading`
- Inspecting routes and matches during development -> `@skills/router/router-devtools`

Next:

- After picking a skill, follow its resource links and guidance.
