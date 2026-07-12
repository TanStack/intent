---
'@tanstack/intent': minor
---

Add consumer-managed `intent.lock` files for reviewing and pinning the exact skill content approved for a project.

- Add `intent skills scan`, `diff`, `approve`, and `update` for inspecting drift, reviewing exact current text and binary summaries, and maintaining approved sources.
- Track sources by `(kind, id)` so same-named workspace and npm packages remain distinct approvals.
- Hash each skill’s `SKILL.md` plus supported `references/`, `assets/`, and `scripts/` files with deterministic SHA-256 content hashes.
- Add frozen-mode enforcement for CI through `--frozen`, `INTENT_FROZEN`, and non-interactive `CI` detection. Frozen mode rejects missing or malformed lockfiles, unapproved source changes, hidden skill-bearing sources, and lockfile mutations.
- When an `intent.lock` exists, reject drift during ordinary skill loading and agent catalog generation so interactive agents cannot silently consume content that differs from the approved state.
- Validate manifests against the installed package identity, skill paths, and content hashes. Manifest metadata changes appear in lockfile diffs and require approval before frozen checks pass.
- Export lockfile metadata types from `@tanstack/intent`.
