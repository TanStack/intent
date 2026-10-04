---
'@tanstack/intent': patch
---

Make the installed package 16 kB smaller and load one to four fewer files in `intent validate`, `intent meta`, and `intent stale`. Modules that these commands had already loaded are now imported directly instead of through a second, deferred import, so the bundle keeps only the parts of `yaml` that Intent uses; behavior does not change.
