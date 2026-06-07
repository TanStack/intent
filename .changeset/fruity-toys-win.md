---
'@tanstack/intent': patch
---

Remove the abandoned `intent-library` bin and its `./intent-library` export. The legacy library-bin discovery model was replaced by the keyword-based model; anything invoking `intent-library` directly must move to the normal `intent` discovery flow (no compatibility shim).
