---
'@tanstack/intent': patch
---

Refuse to load a Yarn PnP runtime resolved from within node_modules; only a project root or ancestor .pnp.cjs is trusted.
