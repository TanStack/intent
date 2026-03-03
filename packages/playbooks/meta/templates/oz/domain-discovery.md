# Oz Prompt: Domain Discovery

Use this prompt with `oz agent run` (local) or `warpdotdev/oz-agent-action` (CI)
to run domain discovery for a library.

## Usage

### Local (interactive — includes maintainer interview)

```bash
oz agent run --prompt "$(cat this-file.md)"
```

### CI (compressed — skips interview phases)

Use the `generate-skills-oz.yml` workflow template instead.

---

## Prompt

Read the meta-skill at `node_modules/@tanstack/playbooks/meta/domain-discovery/SKILL.md`
and follow its instructions for the library described below.

### Library details

- **Package:** [PACKAGE_NAME]
- **Repository:** [REPO_URL]
- **Docs path:** [DOCS_PATH]
- **Primary framework:** [react | vue | solid | svelte | framework-agnostic]

### Instructions

Run the full 5-phase domain discovery process:

1. **Phase 1 — Quick scan:** Orient yourself in the library
2. **Phase 2 — High-level interview:** Ask the maintainer about developer tasks
3. **Phase 3 — Deep read:** Read docs and source, build concept inventory
4. **Phase 4 — Detail interview:** Fill gaps with targeted questions
5. **Phase 5 — Finalize:** Produce domain_map.yaml and skill_spec.md

Write the output artifacts to the repository root:

- `domain_map.yaml`
- `skill_spec.md`

### After completion

Tell the user:

- "Domain discovery complete. Artifacts written to domain_map.yaml and skill_spec.md."
- "Next step: load the tree-generator meta-skill to generate SKILL.md files."
- "Run `npx playbook feedback --meta --interactive` to share how this went."
