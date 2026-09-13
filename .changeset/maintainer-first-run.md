---
'@tanstack/intent': patch
---

Stop reporting files Intent writes as unmapped source changes. Agent instruction files, generated plugin metadata, the CI workflow, package manifests, and lockfiles no longer need a recorded review unless a skill maps them; `review.ignore` in `skill_tree.yaml` adds repository-specific patterns.

Register a skill with the workspace package that owns the current directory when `maintainer add` runs without `--package`. Reject a review record that annotates no outcomes and explain the required fields. Accept per-skill `files` entries written by `maintainer sync` during validation. Advise the current CI workflow version.
