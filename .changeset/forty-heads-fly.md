---
'@tanstack/intent': patch
---

Fix `intent list` suppressing the allow-all risk warning.

When `intent.skills` is set to allow-all (`"*"`), `intent list --no-notices` and `INTENT_NO_NOTICES=1` no longer hide the warning that all skill sources are permitted. This banner is a security-relevant signal, not a migration tip, so it's now excluded from suppression while other notices remain suppressible as before.
