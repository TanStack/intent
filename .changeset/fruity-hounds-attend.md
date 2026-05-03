---
'@tanstack/intent': patch
---

Replace custom version parsing and comparison with `semver` for stale drift reporting and installed package variant selection.

This improves handling for prereleases, build metadata, coerced versions, invalid versions, and downgrades while preserving the existing `major`, `minor`, `patch`, or `null` stale drift output.
