---
'@tanstack/playbooks': patch
---

Add `playbook-library` end-user CLI for library consumers. Libraries wire it up via a generated shim (`playbook setup --shim`) to expose a `playbook` bin. Running `playbook list` recursively discovers skills across the library's dependency tree; `playbook install` prints an agent-driven prompt to map skills to project tasks in CLAUDE.md.
