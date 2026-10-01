---
'@tanstack/intent': patch
---

Detect nub projects from `nub.lock`, a `nub@` `packageManager` field, or a single `devEngines.packageManager` declaration, and generate `nub exec intent` commands for them so guidance, mappings, and hooks run the installed CLI. A single `devEngines.packageManager` entry is now read for every package manager when `packageManager` is absent. `nub.lock` joins the lockfiles that review ignores.
