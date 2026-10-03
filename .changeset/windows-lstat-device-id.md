---
'@tanstack/intent': patch
---

Discover skills on Windows under Node 23 and Node 24.0 through 24.1. Those versions report a zero device id from `lstat` while the opened descriptor reports the real one, so the skill identity check rejected every skill and `intent list` and the session catalog reported none even though `intent load` worked. A zero device id now carries no identity and only the inode is compared.
