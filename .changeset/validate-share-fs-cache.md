---
'@tanstack/intent': patch
---

Make `intent validate` and `intent repair` reuse their per-run filesystem cache across project-context resolution, workspace discovery, and `package.json` reads instead of repeating those walks and reads within a single run; behavior does not change.
