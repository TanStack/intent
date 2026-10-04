---
'@tanstack/intent': patch
---

Write the command parser in the hook script as fixed text, so the script content no longer changes with the build tooling. Hook behavior does not change. The next `intent hooks install` rewrites the installed script once and reports `Updated Intent hooks`; later runs report no changes.
