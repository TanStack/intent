import { join } from 'node:path'

export function runScaffoldCommand(metaDir: string): void {
  function metaSkillPath(name: string): string {
    return join(metaDir, name, 'SKILL.md')
  }

  const prompt = `You are helping a library maintainer scaffold Intent skills.

Run the three meta skills below **one at a time, in order**. For each step:
1. Load the SKILL.md file specified
2. Follow its instructions completely
3. Present outputs to the maintainer for review
4. Do NOT proceed to the next step until the maintainer confirms

## Before you start

Gather this context yourself (do not ask the maintainer — agents should never
ask for information they can discover):
1. Read package.json for library name, repository URL, and homepage/docs URL
2. Detect if this is a monorepo (look for workspaces field, packages/ directory, lerna.json)
3. Use skills/ as the default skills root
4. For monorepos:
   - Domain map artifacts go at the REPO ROOT: _artifacts/
   - Skills go INSIDE EACH PACKAGE: packages/<pkg>/skills/
   - Identify which packages are client-facing (usually client SDKs and primary framework adapters)

---

## Step 1 — Domain Discovery

Load and follow: ${metaSkillPath('domain-discovery')}

This produces: domain_map.yaml and skill_spec.md in the artifacts directory.
Domain discovery covers the WHOLE library (one domain map even for monorepos).

**STOP. Review outputs with the maintainer before continuing.**

---

## Step 2 — Tree Generator

Load and follow: ${metaSkillPath('tree-generator')}

This produces: skill_tree.yaml in the artifacts directory.
For monorepos, each skill entry should include a \`package\` field.

**STOP. Review outputs with the maintainer before continuing.**

---

## Step 3 — Generate Skills

Load and follow: ${metaSkillPath('generate-skill')}

This produces: individual SKILL.md files.
- Single-repo: skills/<domain>/<skill>/SKILL.md
- Monorepo: packages/<pkg>/skills/<domain>/<skill>/SKILL.md

---

## After all skills are generated

1. Run \`intent skills generate-manifest --write\` and review every manifest change
2. Run \`intent skills validate --fix\` and review every mechanical rewrite
3. Run \`intent setup --dry-run\`, then \`intent setup --write\`, to configure every package that now owns skills
4. Run \`intent setup --check\` to verify package and managed workflow state
5. Run \`intent skills validate --release\` to verify the npm package contents
6. Commit the reviewed skills, artifacts, manifests, package configuration, and workflow changes
`

  console.log(prompt)
}
