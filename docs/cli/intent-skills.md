---
title: intent skills
id: intent-skills
---

`intent skills` manages `intent.lock`, the committed record of which skill-bearing sources you've approved and what their content looked like when you approved it. Five subcommands: `scan`, `diff` (read-only), `approve`, `update` (mutating), and `stale` (read-only, checks for skill drift needing re-review).

```bash
npx @tanstack/intent@latest skills <scan|diff|approve|update|stale> [source] [--json] [--all] [--yes] [--frozen] [--no-frozen] [--baseline <ref>] [--files <path...>]
```

See [Lockfile and frozen mode](../security/lockfile) for what `intent.lock` is and what frozen mode guarantees.

## `intent skills scan`

```bash
npx @tanstack/intent@latest skills scan [--json] [--frozen] [--no-frozen]
```

Read-only. Discovers current skill-bearing sources, computes each source's `contentHash`, and reports drift against `intent.lock`.

- No lock found: prints `No intent.lock found. Run \`intent skills approve --all\` to create one.`
- Lock is clean: prints `intent.lock is up to date.`
- Lock is stale: prints `intent.lock is out of date: N added, N removed, N changed.`
- Discovered sources not in `intent.skills`: prints a count and points at `intent.skills`/`intent.exclude`
- `--json` prints `{ frozen, hiddenSourceCount, hasLockfile, added, removed, changed, isClean }`

## `intent skills diff`

```bash
npx @tanstack/intent@latest skills diff [--json] [--frozen] [--no-frozen]
```

Read-only. Same underlying computation as `scan`, but change-focused: prints only `Added:`/`Removed:`/`Changed:` sections with per-field diffs (`version`, `resolution`, `skills`, `contentHash`, `manifestHash`, `capabilities`). Unchanged sources are omitted.

```
Changed:
  ~ npm:@acme/query
      version: "1.0.0" -> "1.1.0"
      resolution: "npm:@acme/query@1.0.0" -> "npm:@acme/query@1.1.0"
      contentHash: "sha256-492ac4..." -> "sha256-2631b3..."
```

## `intent skills approve [source]`

```bash
npx @tanstack/intent@latest skills approve [source] [--all] [--yes]
```

Writes `intent.lock`. This is the trust decision — approving means a human reviewed this exact change.

- **No arg, no `--all`/`--yes`:** interactive per-pending-change prompt (approve/skip each). Fails if stdin isn't a TTY.
- **`--all` or `--yes`:** accepts every pending change (added, removed, changed) without prompting. This is the first-run path that creates the initial lock.
- **A single source:** `approve npm:@tanstack/query`, `approve workspace:my-package`, or a bare name (`approve foo`) if it resolves unambiguously against currently-discovered sources. Two sources sharing a bare name across kinds (`npm:foo` and `workspace:foo`) error instead of guessing — pass `kind:id` explicitly.
- Re-serializes the whole file deterministically: identical inputs produce a byte-identical `intent.lock`.
- Only touches the targeted entry (single-source form) or all pending changes (`--all`/`--yes`) — never silently drops an entry you didn't act on.
- Refuses in frozen mode (exit `5`).

## `intent skills update [source]`

```bash
npx @tanstack/intent@latest skills update [source] [--all] [--yes]
```

Writes `intent.lock`. It mechanically re-syncs version and resolution for matching **already-locked** entries. Changes to skills, content hashes, manifests, capabilities, declared secrets, or MCP metadata require `--yes` after reviewing `intent skills diff`.

- Only touches sources present in **both** the lock and the current scan. It never adds a newly-discovered source (that's `approve`'s job) and never drops a source that's no longer discovered (also `approve`'s job — removing a source from the trust boundary is itself a trust decision).
- Reports pending added/removed drift it didn't touch: `N added, M removed source(s) still pending. Run \`intent skills approve\` to review.`
- Makes zero network calls and zero subprocess calls — it only reads what's already on disk.
- Refuses in frozen mode (exit `5`).

## `intent skills stale`

```bash
npx @tanstack/intent@latest skills stale [--json] [--baseline <ref>] [--files <path...>] [--frozen] [--no-frozen]
```

Read-only. Surfaces staleness **candidates** for human/agent review — never a hard verdict on its own (a candidate means "worth checking," not "broken"). Two layers:

- **Self-integrity + version** (Layer 0/1): reuses the same `intent.lock` diff as `scan`/`diff` — a source whose on-disk `contentHash` or `version` no longer matches the lock is reported as a candidate.
- **Baseline drift** (Layer 2): compares each locked source's tracked skill files against a git baseline via blob SHA, independent of the lockfile diff. Baseline resolution order: `--baseline <ref>` flag, then `intent.lock`'s recorded `staleness.baseline`, then the nearest local git tag. No implicit `HEAD~1` — pass `--baseline HEAD~1` explicitly if that's what you want.
- `--files <path...>` restricts Layer 2 to specific repo-relative paths (CI optimization: pass only the files a diff touched).
- No `intent.lock`: prints `No intent.lock found. Run \`intent skills approve --all\` to create one.` (frozen mode fails, exit `4`).
- No baseline resolvable: interactive mode reports `Layer 2 (baseline drift) skipped: <reason>` and continues with Layer 0/1 only; frozen mode fails closed (exit `5`).
- Makes no network calls. Requires git for Layer 2 only — if `cwd` isn't a git repository, Layer 2 fails the same way as an unresolvable baseline.
- Frozen mode: fails (exit `1`) if any candidate — Layer 0/1 or Layer 2 — was found, so CI gates a PR that hasn't refreshed staleness.

## Options

- `--json`: with `scan`/`diff`, print the structured diff instead of text
- `--all`: with `approve`/`update`, act on all pending changes without prompting
- `--yes`: with `approve`, accept all pending changes non-interactively; with `update`, accept reviewed trust-bearing changes
- `--frozen`: force frozen mode, regardless of `INTENT_FROZEN`/`CI` auto-detection
- `--no-frozen`: force interactive mode — overrides `INTENT_FROZEN` and the `CI` auto-detect (highest-precedence explicit override)
- `--baseline <ref>`: with `stale`, override the git ref used as the staleness baseline
- `--files <path...>`: with `stale`, restrict Layer 2 baseline drift checks to these repo-relative paths

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | ok |
| `1` | generic CLI usage/parse error, or (`stale` only) staleness candidates found under frozen mode |
| `2` | drift found under frozen mode |
| `3` | unapproved/unlisted skill-bearing source found under frozen mode |
| `4` | no `intent.lock` found under frozen mode |
| `5` | `approve`/`update` refused — frozen mode disallows mutation; or (`stale` only) no staleness baseline resolvable under frozen mode |
| `6` | `intent.lock` is malformed or from an unsupported (newer) `lockfileVersion` |

## Related

- [Lockfile and frozen mode](../security/lockfile)
- [Trust model](../concepts/trust-model)
