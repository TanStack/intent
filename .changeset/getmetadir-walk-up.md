---
'@tanstack/intent': patch
---

Fix `setup`, `setup-github-actions`, `meta`, and `scaffold` failing with "No templates directory found" / "Meta-skills directory not found" in the published package. `getMetaDir` hardcoded `../../meta`, which is correct for the `src/commands/` source layout but overshoots to `@tanstack/meta` from the flat `dist/` layout the build ships. Walk up to the first `meta/` directory instead so resolution works in both layouts (and symlinked installs).
