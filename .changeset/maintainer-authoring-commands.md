---
'@tanstack/intent': patch
---

Record developer tasks at registration with `maintainer add --task`, retire a registered skill with `maintainer remove <name>` without deleting its guidance, and include the recording contract (allowed outcomes and required fields) in `review --json` reports. Evidence may be a single string or a list, and the report points at `.intent/review.json`, which review ignores.
