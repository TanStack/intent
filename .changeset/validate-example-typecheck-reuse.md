---
'@tanstack/intent': patch
---

Make `intent validate` faster in workspaces that check examples for more than one library. The workspace package map is now resolved once per run, and parsed library and TypeScript lib files are reused between libraries instead of being parsed again for each one. Validation results are unchanged.
