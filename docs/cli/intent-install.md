---
title: intent install
id: intent-install
---

`intent install` prints instructions for setting up an `intent-skills` mapping block in your project guidance file.

```bash
npx @tanstack/intent@latest install
```

The command prints text only. It does not edit files.

## Output

The printed instructions include this tagged block template:

```yaml
<!-- intent-skills:start -->
# Skill mappings — when working in these areas, load the linked skill file into context.
skills:
  - task: "describe the task or code area here"
    load: "node_modules/package-name/skills/skill-name/SKILL.md"
<!-- intent-skills:end -->
```

They also ask you to:

1. Check for an existing block first
2. Run `intent list` to discover installed skills
3. Add task-to-skill mappings
4. Preserve all content outside the tagged block

## Related

- [intent list](./intent-list)
- [Setting Up Agent Config](../guides/consumers/agent-config-setup)
