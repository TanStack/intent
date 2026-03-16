import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fail } from '../cli-error.js'

export async function runMetaCommand(
  name: string | undefined,
  metaDir: string,
): Promise<void> {
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
      console.log(readFileSync(skillFile, 'utf8'))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      fail(`Failed to read meta-skill "${name}": ${msg}`)
    }

    return
  }

  const { parseFrontmatter } = await import('../utils.js')
  const entries = readdirSync(metaDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => existsSync(join(metaDir, entry.name, 'SKILL.md')))

  if (entries.length === 0) {
    console.log('No meta-skills found.')
    return
  }

  console.log('Meta-skills (for library maintainers):\n')

  for (const entry of entries) {
    const skillFile = join(metaDir, entry.name, 'SKILL.md')
    const fm = parseFrontmatter(skillFile)
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
