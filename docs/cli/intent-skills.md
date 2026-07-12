---
title: intent skills
id: intent-skills
---

`intent skills` manages `intent.lock`, the committed record of which skill-bearing sources you've approved and what their content looked like when you approved it. Four subcommands: `scan`, `diff` (read-only), `approve`, and `update` (mutating).

```bash
npx intent skills <scan|diff|approve|update> [source] [--json] [--all] [--yes] [--frozen] [--no-frozen]
```

See [Lockfile and frozen mode](../security/lockfile) for what `intent.lock` is and what frozen mode guarantees.

## `intent skills scan`

```bash
npx intent skills scan [--json] [--frozen] [--no-frozen]
```

Read-only. Discovers current skill-bearing sources, computes each source's `contentHash`, and reports drift against `intent.lock`.

- No lock found: prints `No intent.lock found. Run \`intent skills approve --all\` to create one.`
- Lock is clean: prints `intent.lock is up to date.`
- Lock is stale: prints `intent.lock is out of date: N added, N removed, N changed.`
- Discovered sources not in `intent.skills`: names each source with bounded dependency provenance when available, falls back to `provenance unknown`, and points at `intent.skills`/`intent.exclude`. Agent-mode output remains count-only.
- `--json` prints `{ frozen, hiddenSourceCount, hasLockfile, added, removed, changed, isClean }`

## `intent skills diff`

```bash
npx intent skills diff [--json] [--frozen] [--no-frozen]
```

Read-only. Same underlying computation as `scan`, but change-focused: prints `Added:`/`Removed:`/`Changed:` sections with per-field diffs (`version`, `resolution`, `skills`, `contentHash`, `manifestHash`, `capabilities`). It then displays the complete current canonical text for every added or changed source. Binary files are summarized by path, byte length, and hash. Control and bidirectional characters are escaped in the line-numbered text display so package content cannot manipulate terminal output. Unchanged sources are omitted.

```
Changed:
  ~ npm:@acme/query
      version: "1.0.0" -> "1.1.0"
      resolution: "npm:@acme/query@1.0.0" -> "npm:@acme/query@1.1.0"
      contentHash: "sha256-492ac4..." -> "sha256-2631b3..."
```

## `intent skills approve [source]`

```bash
npx intent skills approve [source] [--all] [--yes]
```

Writes `intent.lock`. This is the trust decision. Before any prompt or non-interactive write, Intent displays the current canonical text and binary summaries for the affected sources. Removed sources display their locked skill paths and aggregate hash because the old file bytes are not stored in `intent.lock`.

- **No arg, no `--all`/`--yes`:** interactive per-pending-change prompt (approve/skip each). Fails if stdin isn't a TTY.
- **`--all` or `--yes`:** displays every pending change, then accepts them without prompting. This is the first-run path that creates the initial lock.
- **A single source:** `approve npm:@tanstack/query`, `approve workspace:my-package`, or a bare name (`approve foo`) if it resolves unambiguously against currently-discovered sources. Two sources sharing a bare name across kinds (`npm:foo` and `workspace:foo`) error instead of guessing — pass `kind:id` explicitly.
- Re-serializes the whole file deterministically: identical inputs produce a byte-identical `intent.lock`.
- Only touches the targeted entry (single-source form) or all pending changes (`--all`/`--yes`) — never silently drops an entry you didn't act on.
- Refuses in frozen mode (exit `5`).

## `intent skills update [source]`

```bash
npx intent skills update [source] [--all] [--yes]
```

Writes `intent.lock`. It mechanically re-syncs version and resolution for matching **already-locked** entries. Changes to skills, content hashes, manifests, capabilities, declared secrets, or MCP metadata require `--yes`; before writing them, `update` displays the same current content review as `diff` and `approve`.

- Only touches sources present in **both** the lock and the current scan. It never adds a newly-discovered source (that's `approve`'s job) and never drops a source that's no longer discovered (also `approve`'s job — removing a source from the trust boundary is itself a trust decision).
- Reports pending added/removed drift it didn't touch: `N added, M removed source(s) still pending. Run \`intent skills approve\` to review.`
- Makes zero network calls and zero subprocess calls — it only reads what's already on disk.
- Refuses in frozen mode (exit `5`).

## Options

- `--json`: with `scan`/`diff`, print the structured diff instead of text
- `--all`: with `approve`/`update`, act on all pending changes without prompting
- `--yes`: with `approve`, accept all pending changes non-interactively; with `update`, accept reviewed trust-bearing changes
- `--frozen`: force frozen mode, regardless of `INTENT_FROZEN`/`CI` auto-detection
- `--no-frozen`: force interactive mode — overrides `INTENT_FROZEN` and the `CI` auto-detect (highest-precedence explicit override)

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | ok |
| `1` | generic CLI usage or parse error |
| `2` | drift found under frozen mode |
| `3` | unapproved/unlisted skill-bearing source found under frozen mode |
| `4` | no `intent.lock` found under frozen mode |
| `5` | `approve`/`update` refused because frozen mode disallows mutation |
| `6` | `intent.lock` is malformed or from an unsupported (newer) `lockfileVersion` |

## Related

- [Lockfile and frozen mode](../security/lockfile)
- [Trust model](../concepts/trust-model)
