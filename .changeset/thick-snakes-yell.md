---
'@tanstack/intent': patch
---

Add agent-safe hidden skill source handling to `intent list`.

`intent list` now detects agent sessions with `std-env` and redacts unlisted allowlist candidates from agent-facing output. Agents see allowed skills plus a count-only hidden-source notice, while `intent list --show-hidden` reveals hidden source names only outside agent sessions.

Agent-mode JSON output includes `hiddenSourceCount` but leaves `hiddenSources` empty, preventing structured output from leaking package names that could be added to `package.json#intent.skills`.
