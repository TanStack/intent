---
'@tanstack/intent': patch
---

Fix `intent list` in projects with stale Yarn PnP files alongside project `node_modules`, including Bun isolated installs. Intent now prefers project `node_modules` when it exists and only loads Yarn's PnP API for PnP projects without `node_modules`.
