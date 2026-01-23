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
- Choosing installation tooling -> `@skills/router/installation-guides`
- Scaffolding routes with the Router CLI -> `@skills/router/router-cli`
- Defining the overall route hierarchy -> `@skills/router/route-trees`
- Creating a shared UI shell across child routes -> `@skills/router/layouts`
- Stabilizing references when paths change -> `@skills/router/route-ids`
- Attaching route metadata for UI or analytics -> `@skills/router/route-meta`
- Picking a routing strategy -> `@skills/router/routing-strategies`

Routing params and search:

- Reading path params and splats -> `@skills/router/params`
- Validating, defaulting, and reading search params -> `@skills/router/search-params`
- Customizing search param serialization -> `@skills/router/custom-search-serialization`

Data loading and refresh:

- Fetching route-critical data before render -> `@skills/router/loaders`
- Passing dependencies like API clients to loaders -> `@skills/router/route-context`
- Prefetching and invalidating after mutations -> `@skills/router/data-refresh`
- Handling deferred/external data or mutations -> `@skills/router/data-loading-advanced`
- Deferring non-critical data -> `@skills/router/deferred-data-loading`
- Loading data from external caches -> `@skills/router/external-data-loading`
- Integrating TanStack Query -> `@skills/router/query-integration`

Navigation and links:

- Adding typed, declarative navigation links -> `@skills/router/links`
- Configuring link behavior -> `@skills/router/link-options`
- Building custom design-system links -> `@skills/router/custom-links`
- Navigating programmatically after actions -> `@skills/router/navigation`
- Preloading navigation targets -> `@skills/router/preloading`

Matching and router state:

- Reading matches and the current location -> `@skills/router/matching-and-location`
- Showing pending UI or transition state -> `@skills/router/router-state`

Errors, redirects, and masking:

- Handling loader/render errors -> `@skills/router/error-boundaries`
- Handling missing data or unmatched routes -> `@skills/router/not-found-boundaries`
- Redirecting from loaders/actions -> `@skills/router/redirects`
- Presenting friendly URLs for internal routes -> `@skills/router/route-masking`
- Protecting routes behind auth -> `@skills/router/authenticated-routes`

File-based routing:

- Choosing file-based routing or organizing routes by files -> `@skills/router/file-based-routing`

Rendering and runtime:

- Ensuring loader data is serializable for SSR -> `@skills/router/ssr-loaders`
- Lazy-loading route modules for code-splitting -> `@skills/router/route-lazy-loading`
- Inspecting routes and matches during development -> `@skills/router/router-devtools`
- Managing head tags and titles -> `@skills/router/document-head-management`
- Restoring scroll positions between navigations -> `@skills/router/scroll-restoration`
- Blocking navigation on unsaved changes -> `@skills/router/navigation-blocking`
- Choosing history implementations -> `@skills/router/history-types`
- Customizing search param serialization -> `@skills/router/custom-search-serialization`
- Attaching static route data -> `@skills/router/static-route-data`
- Improving render performance -> `@skills/router/render-optimizations`
- Tightening type safety and utilities -> `@skills/router/type-safety`
- Applying Router ESLint rules -> `@skills/router/eslint-plugin-router`
- Adding view transitions -> `@skills/router/view-transitions`

Next:

- After picking a skill, follow its resource links and guidance.
