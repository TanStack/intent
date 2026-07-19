---
'@tanstack/intent': minor
---

Stop encouraging agents to run `intent list` for every task. Supported Claude Code, Codex, and GitHub Copilot lifecycle hooks now inject a compact cached skill catalogue at session and subagent starts, and agents load full skill guidance only for clear task matches.

Add explicit `intent install --mode hooks|fallback|map` modes while preserving plain `intent install` and `--map` compatibility. Fallback guidance is smaller, and reinstalling hooks removes Intent's previous session-wide edit gate because one observed load could not prove task-specific matching. Hook behavior is advisory and fails open.
