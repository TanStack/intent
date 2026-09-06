---
title: intent scaffold
id: intent-scaffold
---

`intent scaffold` prints an entry prompt for creating or updating focused skill guidance with your existing coding agent.

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: @tanstack/intent@latest scaffold
solid: @tanstack/intent@latest scaffold
vue: @tanstack/intent@latest scaffold
svelte: @tanstack/intent@latest scaffold
angular: @tanstack/intent@latest scaffold
lit: @tanstack/intent@latest scaffold

<!-- ::end:tabs -->

Ask your agent to run the command and follow its output in the current conversation:

> Run `intent scaffold` and follow its focused authoring procedure. Help developers configure retries using this package. Create a skill or update the guidance that already covers it.

For an update, refer to the change already under discussion:

> Run `intent scaffold` and follow it to update the retry guidance for the change we just made. Use the existing diff and tests.

The prompt points to `generate-skill`, the authoritative focused procedure. You or your agent can also load it directly:

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: @tanstack/intent@latest meta generate-skill
solid: @tanstack/intent@latest meta generate-skill
vue: @tanstack/intent@latest meta generate-skill
svelte: @tanstack/intent@latest meta generate-skill
angular: @tanstack/intent@latest meta generate-skill
lit: @tanstack/intent@latest meta generate-skill

<!-- ::end:tabs -->

If you run the command yourself, give the printed prompt to your agent with the task or change.

## Behavior

- Prints guidance to stdout; does not create files, run an agent, or change your project.
- Leads with a useful task batch or concrete change; the agent creates or extends the cumulative domain map, spec, and skill tree without requiring full-library discovery.
- Points to shipped meta-skills using paths from the Intent package in use.
- Keeps full-library discovery available when explicitly requested.

> [!NOTE]
> `scaffold` is a standalone prompt entry point. It does not install the persistent maintainer block, configure package publishing, change consumer permissions, or add CI.

The agent returns a focused diff with source evidence and validation results, or an evidence-backed explanation that no guidance needs changing. Missing evidence is reported as uncertainty, not treated as no impact. The CLI does not generate content or automatically identify affected skills.

## Full-library design

Ask your agent to use the full-library branch of the printed prompt. It starts with `domain-discovery`, then `tree-generator`, then `generate-skill`. The discovery interviews and artifact reviews apply to that larger exercise. The public commands remain available individually:

<!-- ::start:tabs variant="package-manager" mode="local-install" -->

react: @tanstack/intent@latest meta domain-discovery
react: @tanstack/intent@latest meta tree-generator
react: @tanstack/intent@latest meta generate-skill
solid: @tanstack/intent@latest meta domain-discovery
solid: @tanstack/intent@latest meta tree-generator
solid: @tanstack/intent@latest meta generate-skill
vue: @tanstack/intent@latest meta domain-discovery
vue: @tanstack/intent@latest meta tree-generator
vue: @tanstack/intent@latest meta generate-skill
svelte: @tanstack/intent@latest meta domain-discovery
svelte: @tanstack/intent@latest meta tree-generator
svelte: @tanstack/intent@latest meta generate-skill
angular: @tanstack/intent@latest meta domain-discovery
angular: @tanstack/intent@latest meta tree-generator
angular: @tanstack/intent@latest meta generate-skill
lit: @tanstack/intent@latest meta domain-discovery
lit: @tanstack/intent@latest meta tree-generator
lit: @tanstack/intent@latest meta generate-skill

<!-- ::end:tabs -->

## Related

- [Maintainer quick start](../getting-started/quick-start-maintainers)
- [intent validate](./intent-validate)
- [intent stale](./intent-stale)
- [setup commands](./intent-setup)
