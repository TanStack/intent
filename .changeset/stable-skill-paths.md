---
'@tanstack/intent': patch
---

Use stable `node_modules/<name>/...` paths for skill references instead of absolute filesystem paths containing package-manager-internal directories with version numbers. Paths no longer break when packages are updated.
