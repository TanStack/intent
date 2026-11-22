import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fail } from '../shared/cli-error.js'
import { errorMessage } from '../shared/guards.js'
import { parseFrontmatter } from '../shared/frontmatter.js'
import { rewriteLoadedSkillMarkdownDestinations } from '../core/markdown.js'

export function runMetaCommand(
  name: string | undefined,
  metaDir: string,
): void {
  if (!existsSync(metaDir)) {
    fail('Meta-skills directory not found.')
  }

  if (name) {
    if (name.includes('..') || name.includes('/') || name.includes('\\')) {
      fail(`Invalid meta-skill name: "${name}"`)
    }

    const skillFile = join(metaDir, name, 'SKILL.md')
    if (!existsSync(skillFile)) {
      fail(
        `Meta-skill "${name}" not found. Run \`intent meta\` to list available meta-skills.`,
      )
    }

    try {
      console.log(
        rewriteLoadedSkillMarkdownDestinations({
          content: readFileSync(skillFile, 'utf8'),
          cwd: process.cwd(),
          packageRoot: dirname(metaDir),
          skillFilePath: skillFile,
        }),
      )
    } catch (err) {
      fail(`Failed to read meta-skill "${name}": ${errorMessage(err)}`)
    }

    return
  }

  const entries = readdirSync(metaDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      skillFile: join(metaDir, entry.name, 'SKILL.md'),
    }))
    .filter((entry) => existsSync(entry.skillFile))

  if (entries.length === 0) {
    console.log('No meta-skills found.')
    return
  }

  console.log('Meta-skills (for library maintainers):\n')

  for (const entry of entries) {
    const fm = parseFrontmatter(entry.skillFile)
    let description = ''
    if (typeof fm?.description === 'string') {
      description = fm.description.replace(/\s+/g, ' ').trim()
    }

    const shortDesc =
      description.length > 60 ? `${description.slice(0, 57)}...` : description
    console.log(`  ${entry.name.padEnd(28)} ${shortDesc}`)
  }

  console.log('\nUsage: load the SKILL.md into your AI agent conversation.')
  console.log('Path: node_modules/@tanstack/intent/meta/<name>/SKILL.md')
}
