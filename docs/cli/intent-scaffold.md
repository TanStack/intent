---
title: intent scaffold
id: intent-scaffold
---

`intent scaffold` prints an entry prompt for creating or updating focused skill guidance with your existing coding agent.

```bash
npx @tanstack/intent@latest scaffold
```

Ask your agent to run the command and follow its output in the current conversation:

> Run `npx @tanstack/intent@latest scaffold` and follow its focused authoring procedure. Help developers configure retries using this package. Create a skill or update the guidance that already covers it.

For an update, refer to the change already under discussion:

> Run `npx @tanstack/intent@latest scaffold` and follow it to update the retry guidance for the change we just made. Use the existing diff and tests.

The prompt points to `generate-skill`, the authoritative focused procedure. You or your agent can also load it directly:

```bash
npx @tanstack/intent@latest meta generate-skill
```

If you run the command yourself, give the printed prompt to your agent with the task or change. You can also author Markdown directly; see the [maintainer quick start](../getting-started/quick-start-maintainers).

## Behavior

- Prints guidance to stdout; does not create files, run an agent, or change your project.
- Leads with a useful task batch or concrete change; the agent creates or extends the domain map, spec, and skill tree without requiring full-library discovery.
- Points to shipped meta-skills using paths from the Intent package in use.
- Keeps full-library discovery available when explicitly requested.

The agent returns a focused diff with source evidence and validation results, or an evidence-backed explanation that no guidance needs changing. Missing evidence is reported as uncertainty, not treated as no impact. The CLI does not generate content or automatically identify affected skills.

## Full-library design

Ask your agent to use the full-library branch of the printed prompt. It starts with `domain-discovery`, then `tree-generator`, then `generate-skill`. The discovery interviews and artifact reviews apply to that larger exercise. The public commands remain available individually:

```bash
npx @tanstack/intent@latest meta domain-discovery
npx @tanstack/intent@latest meta tree-generator
npx @tanstack/intent@latest meta generate-skill
```

## Related

- [Maintainer quick start](../getting-started/quick-start-maintainers)
- [intent validate](./intent-validate)
- [intent stale](./intent-stale)
- [setup commands](./intent-setup)
