---
title: intent maintainer adopt
id: intent-adopt
---

Register existing library skills without rewriting their content. No AI agent is required. Use your repository's installed Intent command for these examples.

## Interactive adoption

```sh
intent maintainer adopt
```

The command discovers Git-visible `skills/**/SKILL.md` files, identifies their owning packages, and compares them with the planning record. Dependency files and hidden agent directories are excluded. Use `--path <directory>` to include a non-hidden custom skill directory relative to the repository root.

Select registrations, supply missing domains, and choose repository distribution separately. Existing domain assignments and distribution choices are retained unless explicitly changed. A final preview lists the registrations and planning files before confirmation. Canceling writes nothing.

Duplicate names, invalid guidance, and missing registered files are reported. Planned and retired entries remain separate; adoption does not reactivate or delete them.

## Agents and automation

Preview and apply are separate operations:

```sh
intent maintainer adopt --json > adoption.json
intent maintainer adopt --apply adoption.json
```

Between these commands, review the plan. Set `selected: true` on each unregistered skill to adopt and supply its `domain`. Keep every entry, identity, and fingerprint. The `distribution` object accepts the current choice, `{ "mode": "none" }`, or a repository selection:

```json
{
  "mode": "repo",
  "repository": "owner/library",
  "skills": ["query"]
}
```

New skills are not selected automatically. Apply rechecks source, records, and relevant instruction files; regenerate the plan if they changed. With several planning locations, pass the same `--artifacts <directory>` on preview and apply.

## CI

CI never opens interactive prompts, even with an attached terminal. `adopt --json` is read-only and returns zero when it successfully produces a report; unregistered skills in that report do not mean the report failed. Applying a reviewed plan is an explicit repository mutation, not a routine CI check.

For a read-only CI gate after adoption, run:

```sh
intent maintainer check --base <available-base-commit>
```

This checks authored coverage, synchronization, validation, and recorded review. It exits nonzero for unresolved work. Make the comparison commit available in the checkout. CI does not supply semantic review decisions automatically.

## After adoption

Adoption creates missing planning records, appends registrations, preserves skill text and purpose, and installs maintainer guidance. Repeating the flow with a fresh unchanged plan preserves records. It does not synchronize package metadata, generate exports, publish, or record semantic review outcomes.

Run `intent maintainer status`, complete task coverage, synchronize, assess and record source review, then run `intent maintainer check`. Registration does not establish that guidance is correct.