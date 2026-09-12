---
'@tanstack/intent': patch
---

Run the skill checks from a reusable GitHub workflow. `intent maintainer setup` now copies a short `check-skills.yml` that calls `TanStack/intent/.github/workflows/check-skills.yml` pinned to a major tag, so changes to the pipeline reach every repository on the next Intent release without an edit to the caller. `intent maintainer check --github-summary` writes the authoring issues, files to sync, and pending review items to the GitHub Actions step summary, and the reusable workflow passes it.
