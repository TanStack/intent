---
title: Lockfile and frozen mode
id: lockfile
---

`intent.lock` is a committed, per-project record of which skill-bearing sources you've approved and what their content looked like when you approved it. It closes the gap [source trust](../concepts/trust-model) leaves open: `package.json#intent.skills` controls which packages *may* contribute skills, but nothing records what those sources *contained* when you allowed them — so an allowlisted package could silently change its skill content and nothing would notice. `intent.lock` is that record.

This is tamper-evidence, not semantic validation. Approving a source means **a human reviewed this exact change** — never "Intent verified this skill is safe."

## What's in the file

`intent.lock` lives at the project root, alongside `package.json`. It's strict JSON (not JSONC), canonically serialized (sorted keys, two-space indent, trailing newline) so identical inputs always produce a byte-identical file.

```json
{
  "lockfileVersion": 1,
  "intentVersion": "0.3.5",
  "sources": [
    {
      "id": "@acme/query",
      "kind": "npm",
      "version": "1.0.0",
      "resolution": "npm:@acme/query@1.0.0",
      "skills": ["skills/fetching/SKILL.md"],
      "contentHash": "sha256-492ac46894f5f36ebbf314b8312e320b5e3c7836b824b0a74f1a639728a877d7",
      "manifestHash": null,
      "capabilities": null
    }
  ],
  "policy": { "ignores": [] }
}
```

- **`sources[]`** is keyed by `(kind, id)`, never `id` alone — `workspace:foo` and `npm:foo` are distinct entries and distinct approvals.
- **`skills[]`** is the sorted list of package-relative `SKILL.md` paths that fed `contentHash`. It's what lets `diff` show *which files* changed, not just an opaque hash flip.
- **`contentHash`** is a `sha256-` digest over each source's `SKILL.md` files (path + bytes, LF-normalized). Only `SKILL.md` files are hashed — scripts, assets, and other files under `skills/` are out of scope for now. A file rename with identical bytes changes the hash, because a path change is a real content-set change.
- **`manifestHash`** and **`capabilities`** are `null` until the package ships a `skills/intent.manifest.json` (see [`intent skills generate-manifest`](../cli/intent-skills#intent-skills-generate-manifest)). Once a manifest exists, `manifestHash` is populated and `capabilities` is always an array: `[]` means the manifest declares none; a non-empty array is the union of declared capabilities. `declaredSecrets`, `mcpTools`, and `mcpPolicy` remain reserved and, if present (e.g. written by a newer Intent version), are preserved on read/write but not required.
- **`policy.ignores`** is a reserved block; nothing writes to it yet, but it's round-tripped verbatim if present.
- **`staleness.baseline`** (`{ kind: "tag", ref, commit }`) is a reserved, optional field read by [`intent skills stale`](../cli/intent-skills#intent-skills-stale) as one input to baseline resolution. Nothing currently writes it — when absent, `stale` falls back to the nearest local git tag.
- A `lockfileVersion` newer than this Intent version supports, a duplicate `(kind, id)` entry, or any other structural problem is a **malformed lockfile** — fails closed, never silently treated as an empty lock.

## Commands

`intent.lock` is managed entirely by the [`intent skills`](../cli/intent-skills) command group: `scan`/`diff`/`stale` (read-only) and `approve`/`update` (mutating). `generate-manifest` is maintainer-only and never touches `intent.lock` — it writes a package's own `skills/intent.manifest.json`.

## Frozen mode

Frozen mode is the CI gate: it turns "an allowlisted source's content silently drifted" from a warning into a hard failure, and guarantees the check itself makes no outbound network calls or subprocess calls.

**Detection, highest precedence first:**

1. `--no-frozen` flag — forces interactive, overriding everything below
2. `--frozen` flag — forces frozen
3. `INTENT_FROZEN` truthy (`1`/`true`/`yes`/`on`)
4. `CI` truthy **and** stdin is not a TTY — auto-detect
5. otherwise interactive

**What frozen mode does:**

- Refuses `approve`/`update` outright — no mutation, exit `5`.
- Still allows `scan`, `diff`, `list`, `load` (read-only).
- Fails on any pending drift — added, removed, or changed source (exit `2`).
- Fails on a discovered skill-bearing source that isn't in `intent.lock` (exit `3`).
- Fails if there's no `intent.lock` at all (exit `4`) — run `approve --all` interactively first.
- Fails closed on a malformed or unsupported `intent.lock` (exit `6`).
- Makes zero network calls (skips the staleness-check registry lookup) and zero subprocess calls (skips shelling out to a package manager to detect a global install path).

See [`intent skills`](../cli/intent-skills#exit-codes) for the full exit-code table.

## What this does and doesn't solve

- **Solves:** an allowlisted package's skill content changing without a human noticing, in CI.
- **Solves:** distinguishing a `workspace:foo` package from a same-named `npm:foo` package — they're separate approvals.
- **Does not solve:** deciding whether a package should be trusted in the first place — that's still `package.json#intent.skills`, a human decision.
- **Does not solve:** validating that skill content is semantically safe or correct — approving is "a human reviewed this," not "Intent verified this."
- **Does not solve:** anything about a `git:` source kind — that kind is still parsed and rejected, same as before this feature.
