---
'@tanstack/intent': patch
---

Load `validate` and `review` command modules in `intent maintainer` only when the requested action uses them. `maintainer setup`, `add`, `remove`, and `sync` no longer evaluate the validation, example-checking, and review command bundles at startup; behavior does not change.
