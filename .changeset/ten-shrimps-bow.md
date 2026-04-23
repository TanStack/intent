---
'@tanstack/intent': patch
---

Improve `intent stale` for monorepos by checking repo `_artifacts` coverage, flagging uncovered public workspace packages, and ignoring private workspaces.

The generated skills workflow now opens one grouped review PR with maintainer prompts, includes a workflow version stamp, and `intent stale` warns when maintainers should rerun `intent setup`.