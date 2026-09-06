---
'@tanstack/intent': minor
---

Bring library skill authoring and maintenance into the normal coding-agent workflow. `intent install --maintainer` installs persistent guidance for agreed skill batches, source-grounded updates, representative executable task checks, and fresh-consumer verification when available.

Add `intent review` to identify affected guidance and unmapped changes from Git, then record evidence-backed outcomes against source and skill content hashes. Repeated no-ops stay quiet until content changes; missing source evidence remains unresolved. The generated release workflow uses recorded reviews when present and retains the existing staleness fallback otherwise.

Require every authoring batch to create and incrementally maintain `domain_map.yaml`, `skill_spec.md`, and `skill_tree.yaml`, preserving prior coverage, maintainer decisions, and remaining work. Track their review against source and skill contents and keep missing or invalid records unresolved. Keep focused authoring available through `scaffold`, `meta generate-skill`, and review reminders without mandatory full-library discovery. Add maintainer fixtures and protected task graders.

Separate activation guidance in `description` from descriptive text in `metadata.purpose`, preserving original descriptions when migrating existing skills. Expose purpose separately in discovery and `list --json`; older skills remain supported. Group related features by developer task, use references for conditional detail, check discovery separately from task correctness, and bundle tested scripts only when useful.

Keep the review-state lock held through atomic replacement, explain stale locks, and render repository-controlled review fields as untrusted data. Use the same command runner for reminder follow-up review commands.
