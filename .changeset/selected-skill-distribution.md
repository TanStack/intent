---
'@tanstack/intent': minor
---

Add explicit repository skill distribution to the maintainer command workflow. Keep skills in their owning packages, record the selection or opt-out in `skill_tree.yaml`, and generate Claude/Cursor plugin metadata and consumer install commands for `npx skills add` and `gh skill add`. Preserve unrelated plugin fields, require explicit prerequisite selection, and check generated files for drift without publishing or installing anything on the maintainer's behalf.
