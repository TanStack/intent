---
'@tanstack/intent': patch
---

Match a skill source in `review` when its path is nested. Git dropped the matches when the source came before the `node_modules` exclude, so a valid source reported no available files.
