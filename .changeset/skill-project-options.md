---
'@tanstack/intent': patch
---

Add project options for skills. A skill can ship an `options.json` file beside its `SKILL.md` that declares choices, each with a question, the allowed values, and a default. A project records its answers under `intent.options` in `package.json`, and `intent load` appends a `## Project options` section with the recorded choices and the defaults for the rest. `intent validate` checks the file. Skills without `options.json` load unchanged.
