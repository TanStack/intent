---
'@tanstack/intent': patch
---

Fix skill discovery in Yarn Berry (PnP) projects. With `nodeLinker: pnp` and no
`node_modules`, dependencies live in `.yarn/cache/*.zip` archives readable only
through Yarn's libzip-patched filesystem. `intent list` and `intent load` now
read package metadata and `SKILL.md` files from those archives — including when
Intent runs via `npx`/`dlx` from outside the project's PnP graph. A failed PnP
load fails closed with a clear diagnostic, and the PnP resolution hook is no
longer left installed in Intent's process.

Speed up skill discovery. Frontmatter parsing now reads only the leading region
of each `SKILL.md` instead of the whole file (~4x faster on large skill bodies),
and dependency resolution reuses its module resolver per package instead of
rebuilding it for every dependency. Also drops redundant filesystem checks in the
skill-file walk.
