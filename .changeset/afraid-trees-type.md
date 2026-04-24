---
'@tanstack/intent': patch
---

Harden Intent skill checks for nested workspaces, generated GitHub workflows, Yarn PnP discovery, and Agent Skills spec compatibility.

`intent validate` now discovers package-local `skills/` directories from workspace configuration, including nested layouts. The generated `check-skills.yml` workflow now delegates PR validation and release/manual review PR generation to the CLI. `intent stale --github-review` writes review files with the reasons each skill or package was flagged.

Intent package scanning also supports Yarn PnP projects through Yarn's PnP API, and validation now emits warning-only Agent Skills spec compatibility notices without failing existing Intent skills.
