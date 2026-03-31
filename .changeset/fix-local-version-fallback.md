---
'@tanstack/intent': patch
---

Read local package.json version before falling back to npm registry in `intent stale`. This fixes version drift detection for packages not published to public registry.npmjs.org (e.g. GitHub Packages, Artifactory, private registries).
