---
'@tanstack/intent': minor
---

Add a persistent `intent exclude` command for managing `package.json#intent.exclude` (`list`, `add`, `remove`), and document it in the CLI/config guides.

Add notice suppression controls for automation:

- `--no-notices` on `intent list` and `intent install`
- `INTENT_NO_NOTICES=1` environment variable

Remove one-off CLI exclude flags from command surfaces (`list/load --exclude`); excludes are now managed via `package.json#intent.exclude` and `intent exclude`.
