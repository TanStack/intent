---
'@tanstack/intent': minor
---

Add explicit repository skill distribution to the maintainer command workflow. Package-only distribution is the default and needs no record. Keep skills in their owning packages, record a selection or an explicit opt-out in `skill_tree.yaml`, and generate Claude/Cursor plugin metadata and consumer install commands for `npx skills add` and `gh skill add`. Preserve unrelated plugin fields, require explicit prerequisite selection, and check generated files for drift without publishing or installing anything on the maintainer's behalf.

Find selected package skills even when root-level skills exist, and reject conflicting Claude marketplace-only definitions before writing generated files.
