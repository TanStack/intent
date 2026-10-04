---
'@tanstack/intent': patch
---

Make the installed package 35 kB smaller. `intent stale` now bundles only the `semver` functions it uses instead of the whole library; behavior does not change.
