---
'@tanstack/intent': patch
---

Run skill checks through reusable GitHub workflows pinned to the immutable commit packaged with the installed Intent release. Setup validates generated workflow inputs and write paths before copying files. Analysis uses the repository's locked CLI, disables dependency lifecycle scripts, and has read permissions. Optional review publication runs separately with bounded report validation.

The PR workflow runs one combined validation check and can prepare mechanical repairs and suggested example patches for review. It retains the patches when validation fails and never publishes fixes or marks semantic reviews complete. `intent maintainer check --github-summary` reports authoring issues, stale generated files, and pending source reviews in the GitHub Actions step summary.
