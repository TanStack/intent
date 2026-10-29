---
'@tanstack/intent': minor
---

Add optional skill transforms for persistent project onboarding and individualized guidance. `intent load` invokes `load()`, and the new `intent configure` forwards question/answer pairs and stdin to `configure()`. Both functions receive invocation-aware load/configure commands for their instructions. Transforms run with in-memory skill/config filesystems inside a restricted Node subprocess and VM on Node 22+.
