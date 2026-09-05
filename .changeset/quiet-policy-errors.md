---
'@tanstack/intent': patch
---

Stop policy-controlled skill listing and loading when a project policy manifest is unreadable, malformed, or not a JSON object. Report the manifest path instead of treating failed reads as missing policy and exposing skills. Preserve migration behavior for genuinely missing manifests.
