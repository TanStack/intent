---
'@tanstack/intent': patch
---

Refresh workspace roots, patterns, and members between core operations. Keep workspace discovery reuse within the existing operation-local filesystem cache so listing and loading observe changed membership and source kinds.

Avoid enumerating unrelated workspace members and reading unused skill metadata during direct loads. Preserve fresh policy reads and final path checks.
