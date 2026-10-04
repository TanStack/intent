---
'@tanstack/intent': patch
---

Make the installed package 16 kB smaller and load fewer files in each command. `intent validate` and `intent stale` imported modules a second time through a deferred import, although the same files had already loaded them. Those modules are now imported directly, so the bundle keeps only the parts of `yaml` that Intent uses; behavior does not change.
