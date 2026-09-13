---
'@tanstack/intent': patch
---

Fix Windows path handling. Preserve backslash escapes in Markdown link destinations when `intent load` and `intent meta` rewrite relative paths (an escaped `\)` was normalized into a path separator). Normalize the Git repository root reported by `git rev-parse` so `intent maintainer add` no longer rejects every skill path with "must belong to the selected package", and print repository-relative paths in maintainer output and `maintainer status --json` with forward slashes on every platform.
