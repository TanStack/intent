---
'@tanstack/intent': patch
---

Report `intent.skills` entries that name a skill the package does not ship. An exact entry such as `@tanstack/query#fetching` yielded no skill and no message when the installed package had removed or renamed that skill; Intent now emits one notice that names the entry.
