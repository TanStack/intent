import { basename, dirname } from 'node:path'
import { isDeepStrictEqual } from 'node:util'
import { parseDocument } from 'yaml'
import type { FileChange } from '../maintainer/files.js'

export const agentSkillNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const metadataKeys = [
  'type',
  'library',
  'library_version',
  'framework',
] as const

export function planFrontmatterRepair(path: string, source: string) {
  const changes: Array<string> = []
  const problems: Array<string> = []
  const match = source.match(
    /^---(\r?\n)([\s\S]*?)(\r?\n)---(\r?\n?)([\s\S]*)$/,
  )
  if (!match) return { changes, problems: ['Missing or invalid frontmatter'] }
  const [, opening, frontmatter, closing, afterClose, body] = match
  const document = parseDocument(frontmatter!)
  if (document.errors.length)
    return {
      changes,
      problems: document.errors.map(
        (error) => `Invalid YAML frontmatter: ${error.message}`,
      ),
    }
  let fields: unknown
  try {
    fields = document.toJS()
  } catch (error) {
    return {
      changes,
      problems: [
        `Invalid YAML frontmatter: ${error instanceof Error ? error.message : String(error)}`,
      ],
    }
  }
  if (!fields || typeof fields !== 'object' || Array.isArray(fields))
    return { changes, problems: ['Frontmatter must be a mapping'] }
  const fm = fields as Record<string, unknown>
  const expected = { ...fm }
  const metadata = fm.metadata
  const canMove =
    metadata === undefined ||
    (!!metadata && typeof metadata === 'object' && !Array.isArray(metadata))
  if (canMove) {
    for (const key of metadataKeys) {
      if (
        typeof fm[key] === 'string' &&
        document.hasIn(['metadata', key]) &&
        document.getIn(['metadata', key]) !== fm[key]
      )
        problems.push(
          `Conflicting values for "${key}" and "metadata.${key}"; choose the correct value before fixing.`,
        )
    }
    // Never choose between conflicting values, including while fixing another
    // field in the same file. The maintainer must resolve the conflict first.
    if (problems.length) return { fields: fm, changes, problems }
  } else problems.push('metadata must be a mapping')

  let next: string
  try {
    const parent = basename(dirname(path))
    if (
      typeof fm.name === 'string' &&
      fm.name !== parent &&
      parent.length <= 64 &&
      agentSkillNamePattern.test(parent)
    ) {
      document.set('name', parent)
      expected.name = parent
      changes.push(`rewrite name to "${parent}"`)
    }
    if (canMove) {
      const expectedMetadata = {
        ...(metadata as Record<string, unknown> | undefined),
      }
      for (const key of metadataKeys) {
        if (typeof fm[key] !== 'string') continue
        if (document.hasIn(['metadata', key])) {
          changes.push(
            `remove duplicate top-level "${key}"; metadata.${key} has the same value`,
          )
        } else {
          document.setIn(['metadata', key], document.get(key, true))
          changes.push(`move top-level "${key}" under metadata.${key}`)
        }
        document.delete(key)
        expectedMetadata[key] = fm[key]
        expected.metadata = expectedMetadata
        delete expected[key]
      }
    }
    if (!changes.length) return { fields: fm, changes, problems }
    next = document.toString().replace(/\r?\n$/, '')
    const parsed = parseDocument(next)
    if (parsed.errors.length || !isDeepStrictEqual(parsed.toJS(), expected))
      throw new Error('Unexpected frontmatter change')
  } catch {
    return {
      fields: fm,
      changes: [],
      problems: [
        ...problems,
        'Repair cannot preserve unrelated frontmatter values and aliases; review this migration manually.',
      ],
    }
  }
  if (opening === '\r\n') next = next.replace(/\r?\n/g, '\r\n')
  const change: FileChange = {
    path,
    source,
    content: `---${opening}${next}${closing}---${afterClose}${body}`,
  }
  return { fields: fm, changes, problems, change }
}
