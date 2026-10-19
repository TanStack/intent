---
'@tanstack/intent': patch
---

Skip the `_artifacts` coverage scan in `intent stale` when a workspace package already has a generated `SKILL.md`. `buildWorkspaceCoverageSignals` checked whether each package had a generated skill and then still searched `artifacts.skills` before using that result; continuing as soon as a generated skill is found avoids scanning the artifact list for covered packages without changing reported signals.
