---
'@tanstack/intent': patch
---

Replace hardcoded `TanStack/intent` dispatch target in `notify-intent.yml` template with `${{ github.repository }}` so the workflow works for any repo, not just TanStack org libraries.
