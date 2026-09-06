import { join } from 'node:path'

export function runScaffoldCommand(metaDir: string): void {
  function metaSkillPath(name: string): string {
    return join(metaDir, name, 'SKILL.md')
  }

  const prompt = `You are helping a library maintainer create or update Intent skills.

## A useful skill batch or a concrete library change

Load [generate-skill](<${metaSkillPath('generate-skill')}>) and follow its focused authoring procedure using the maintainer's current request.

## Full-library design (only when explicitly requested)

Start with [domain-discovery](<${metaSkillPath('domain-discovery')}>) for the library-wide interview and domain map. After its review gates, use [tree-generator](<${metaSkillPath('tree-generator')}>) to plan the skill tree, then generate-skill to write the selected skills.

This command only prints guidance. Your existing coding agent performs the authoring work; review its diff and validation results in your repository.
`

  console.log(prompt)
}
