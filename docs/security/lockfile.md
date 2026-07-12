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
- **`skills[]`** is the sorted list of package-relative `SKILL.md` paths in the aggregate. Supporting-file changes still change `contentHash`.
- **`contentHash`** is a `sha256-` digest over each listed `SKILL.md` plus files under that skill's `references/`, `assets/`, and `scripts/` directories. Text line endings normalize to LF; binary bytes remain exact. A file rename with identical bytes changes the hash.
- **`manifestHash`** and **`capabilities`** are `null` until the package ships a `skills/intent.manifest.json`. An existing manifest must parse and match the installed package identity, skill paths, and per-skill hashes. Once it does, `manifestHash` is populated and `capabilities` is always an array: `[]` means the manifest declares none; a non-empty array is the union of declared capabilities. Manifest authoring remains M3 work. `declaredSecrets`, `mcpTools`, and `mcpPolicy` remain reserved fields for the current lockfile version.
- **`policy.ignores`** is a reserved block; nothing writes to it yet, but it's round-tripped verbatim if present.
- **`staleness.baseline`** (`{ kind: "tag", ref, commit }`) is reserved for the M7 staleness workflow. M2 validates and preserves it when rewriting an existing lockfile, but no M2 command derives behavior from it.
- A `lockfileVersion` newer than this Intent version supports, an undeclared field, a duplicate `(kind, id)` entry, a non-canonical skill path, or any other structural problem is a **malformed lockfile**. Intent fails closed and never silently treats it as an empty lock.

## Commands

`intent.lock` is managed entirely by the [`intent skills`](../cli/intent-skills) command group: `scan`/`diff` (read-only) and `approve`/`update` (mutating).

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
- `scan` and `diff` make zero network calls and skip subprocess-based global package-manager detection.

See [`intent skills`](../cli/intent-skills#exit-codes) for the full exit-code table.

## Consumer CI

Run the frozen scan in the consumer repository after dependencies and `intent.lock` are present:

```yaml
- name: Verify approved skill sources
  run: npx intent skills scan --frozen
```

The generated `Check Skills` workflow is for library-maintainer validation and review; it does not add this consumer lockfile gate automatically.

## What this does and doesn't solve

- **Solves:** an allowlisted package's skill content changing without a human noticing, in CI.
- **Solves:** distinguishing a `workspace:foo` package from a same-named `npm:foo` package — they're separate approvals.
- **Does not solve:** deciding whether a package should be trusted in the first place — that's still `package.json#intent.skills`, a human decision.
- **Does not solve:** validating that skill content is semantically safe or correct — approving is "a human reviewed this," not "Intent verified this."
- **Does not solve:** anything about a `git:` source kind — that kind is still parsed and rejected, same as before this feature.
