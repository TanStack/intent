---
'@tanstack/intent': patch
---

Ship `@tanstack/intent` with zero runtime dependencies. The libraries it uses (`yaml`, `semver`, `jsonc-parser`, `cac`, `std-env`, `@clack/prompts`) are now bundled and tree-shaken into `dist`, which cuts the install footprint from roughly 2.4 MB across 10 packages to under 1 MB in one, and makes every command start faster because Node loads a few chunks instead of ~150 files from `node_modules`.
