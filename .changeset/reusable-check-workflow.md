---
'@tanstack/intent': patch
---

Run the skill checks from reusable GitHub workflows. `intent maintainer setup` now copies a short `check-skills.yml` whose two jobs call `TanStack/intent/.github/workflows/check-skills.yml` and `review-skills.yml`, pinned to the commit of the Intent release that copied it, so Dependabot and Renovate bump the pin like any other action. The pull-request job runs with `contents: read` only, the review job with the two write permissions it needs, and both run the repository's own lockfile-pinned copy of `@tanstack/intent` unless the `intent-version` input asks for a registry install. `intent maintainer check --github-summary` writes the authoring issues, files to sync, and pending review items to the GitHub Actions step summary, and the reusable workflow passes it.
