# Oz Prompt: Tree Generation

Use this prompt with `oz agent run` (local) or `warpdotdev/oz-agent-action` (CI)
to generate a complete skill tree from domain discovery artifacts.

## Prerequisites

- `domain_map.yaml` and `skill_spec.md` in the repo (from domain discovery)
- `@tanstack/playbooks` installed

---

## Prompt

Read the meta-skill at `node_modules/@tanstack/playbooks/meta/tree-generator/SKILL.md`
and follow Workflow A (Generate) instructions.

### Inputs

- `domain_map.yaml` — in the repository root
- `skill_spec.md` — in the repository root
- Library source documentation is at [DOCS_PATH]

### Task

1. Read domain_map.yaml and skill_spec.md
2. Plan the file tree based on the skill inventory
3. Generate all SKILL.md files following the tree-generator spec
4. Write files under `skills/` in the appropriate package directory
5. Run `npx playbook validate skills/` to verify all files pass
6. Fix any validation errors

### Output structure

Write skills following the structure recommended in the domain map.
Ensure every skill from domain_map.yaml has a corresponding SKILL.md file.

### After completion

Tell the user:
- "Skill tree generated. [N] skills written to skills/."
- "Validation: [PASS/FAIL with details]"
- "Next steps:"
  - "1. Review the generated skills for accuracy"
  - "2. Add `\"skills\"` to your package.json `files` array"
  - "3. Add the `playbook` field to your package.json"
  - "4. Run `npx playbook feedback --meta --interactive` to share how this went"
