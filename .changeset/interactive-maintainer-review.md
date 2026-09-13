---
'@tanstack/intent': minor
---

Add optional interactive maintainer review with guidance and source-diff inspection, per-item reasons and evidence, and confirmation before recording. Reuse existing fingerprints and evidence validation, retain JSON workflows, and prohibit interactive prompts in CI. Add `maintainer review --unchanged <reason>` and `--updated <reason>` to record one outcome for every pending item in a single command, with the reviewed revision and changed files as evidence.
