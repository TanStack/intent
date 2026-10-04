---
'@tanstack/intent': patch
---

Recognize a `skill_tree.yaml` entry whose `path` repeats its `package` directory. `intent maintainer status` and `check` reported every such skill as `Missing skill` although the file existed; they now find the skill and list the tree as a file to synchronize, and `intent maintainer sync` rewrites the path relative to the package.
