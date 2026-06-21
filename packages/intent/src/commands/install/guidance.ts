import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { formatIntentCommand } from '../../shared/command-runner.js'
import { isGeneratedMappingSkill } from '../../skills/categories.js'
import { formatSkillUse, parseSkillUse } from '../../skills/use.js'
import type { ScanResult, SkillEntry } from '../../shared/types.js'

const INTENT_SKILLS_START = '<!-- intent-skills:start -->'
const INTENT_SKILLS_END = '<!-- intent-skills:end -->'
const LOCAL_PATH_VALUE_PATTERN =
  /(?:^|[\s"'])(?:\.{1,2}[\\/]|~[\\/]|[A-Za-z]:[\\/]|\/(?:Users|home|private|tmp|var\/folders)[\\/]|[^\s"']*(?:node_modules|\.pnpm|\.bun|\.yarn|\.intent)[\\/])/i

const SUPPORTED_AGENT_CONFIG_FILES = [
  'AGENTS.md',
  'CLAUDE.md',
  '.cursorrules',
  '.github/copilot-instructions.md',
]

export interface IntentSkillsBlockResult {
  block: string
  mappingCount: number
}

export interface WriteIntentSkillsBlockOptions extends IntentSkillsBlockResult {
  root: string
  skipWhenEmpty?: boolean
}

interface WriteIntentSkillsBlockFileResult {
  mappingCount: number
  status: 'created' | 'unchanged' | 'updated'
  targetPath: string
}

interface WriteIntentSkillsBlockSkippedResult {
  mappingCount: number
  status: 'skipped'
  targetPath: null
}

export type WriteIntentSkillsBlockResult =
  | WriteIntentSkillsBlockFileResult
  | WriteIntentSkillsBlockSkippedResult

interface ManagedBlock {
  end: number
  start: number
  text: string
}

interface IntentSkillsVerificationResult {
  errors: Array<string>
  ok: boolean
}

function normalizeBlock(content: string): string {
  return content.replace(/\r\n/g, '\n').trimEnd()
}

function readManagedBlock(content: string): {
  errors: Array<string>
  hasMarker: boolean
  managedBlock: ManagedBlock | null
} {
  const start = content.indexOf(INTENT_SKILLS_START)
  const errors: Array<string> = []
  if (start === -1) errors.push('Missing intent-skills start marker.')

  const endMarkerStart =
    start === -1
      ? content.indexOf(INTENT_SKILLS_END)
      : content.indexOf(INTENT_SKILLS_END, start)
  if (endMarkerStart === -1) errors.push('Missing intent-skills end marker.')

  const hasMarker = start !== -1 || endMarkerStart !== -1

  if (errors.length > 0 || start === -1 || endMarkerStart === -1) {
    return { errors, hasMarker, managedBlock: null }
  }

  const end = endMarkerStart + INTENT_SKILLS_END.length
  return {
    errors,
    hasMarker,
    managedBlock: {
      end,
      start,
      text: content.slice(start, end),
    },
  }
}

function parseSkillsList(block: string): {
  errors: Array<string>
  mappings: Array<unknown>
} {
  const yamlBody = normalizeBlock(block)
    .split('\n')
    .filter(
      (line) => line !== INTENT_SKILLS_START && line !== INTENT_SKILLS_END,
    )
    .join('\n')

  try {
    const parsed = parseYaml(yamlBody) as {
      tanstackIntent?: unknown
    } | null
    if (!parsed || !Array.isArray(parsed.tanstackIntent)) {
      return {
        errors: ['Managed block must contain a tanstackIntent list.'],
        mappings: [],
      }
    }

    return { errors: [], mappings: parsed.tanstackIntent }
  } catch (err) {
    return {
      errors: [
        `Managed block contains invalid YAML: ${err instanceof Error ? err.message : String(err)}`,
      ],
      mappings: [],
    }
  }
}

function containsLocalPathValue(value: string): boolean {
  return LOCAL_PATH_VALUE_PATTERN.test(value)
}

function parseLoadedSkillUse(command: string): string | null {
  const match = command.match(
    /(?:^|&&|\|\||;|\|)\s*(?:bunx\s+@tanstack\/intent(?:@latest)?|pnpm\s+exec\s+intent|pnpm\s+dlx\s+@tanstack\/intent(?:@latest)?|npx\s+@tanstack\/intent(?:@latest)?|yarn\s+dlx\s+@tanstack\/intent(?:@latest)?|intent)\s+load\s+([^\s|;&]+)/i,
  )
  return match?.[1] ?? null
}

export function verifyIntentSkillsBlockFile({
  expectedBlock,
  expectedMappingCount,
  targetPath,
}: {
  expectedBlock: string
  expectedMappingCount?: number
  targetPath: string
}): IntentSkillsVerificationResult {
  const errors: Array<string> = []

  if (!existsSync(targetPath)) {
    return {
      errors: [`Agent config file was not created: ${targetPath}`],
      ok: false,
    }
  }

  const { managedBlock, errors: markerErrors } = readManagedBlock(
    readFileSync(targetPath, 'utf8'),
  )
  errors.push(...markerErrors)

  if (!managedBlock) {
    return { errors, ok: false }
  }

  const block = managedBlock.text
  if (normalizeBlock(block) !== normalizeBlock(expectedBlock)) {
    errors.push('Managed block does not match generated mappings.')
  }

  if (containsLocalPathValue(block)) {
    errors.push('Managed block must not include local file paths.')
  }

  if (expectedMappingCount === undefined) {
    return {
      errors,
      ok: errors.length === 0,
    }
  }

  const { mappings, errors: parseErrors } = parseSkillsList(block)
  errors.push(...parseErrors)
  if (mappings.length !== expectedMappingCount) {
    errors.push(
      `Expected ${expectedMappingCount} skill mappings, found ${mappings.length}.`,
    )
  }

  for (const mappingValue of mappings) {
    if (!mappingValue || typeof mappingValue !== 'object') {
      errors.push('Each skill mapping must be an object.')
      continue
    }

    const mapping = mappingValue as {
      for?: unknown
      id?: unknown
      run?: unknown
      use?: unknown
      when?: unknown
    }

    if (mapping.use !== undefined) {
      errors.push('Skill mappings must use `id` entries, not `use`.')
    }

    if (mapping.when !== undefined) {
      errors.push('Skill mappings must use compact `for` entries, not `when`.')
    }

    let parsedId: ReturnType<typeof parseSkillUse> | null = null

    if (typeof mapping.id !== 'string') {
      errors.push('Each skill mapping must include an `id` field.')
    } else {
      try {
        parsedId = parseSkillUse(mapping.id)
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err))
      }

      if (containsLocalPathValue(mapping.id)) {
        errors.push('Skill mapping `id` must not include local file paths.')
      }
    }

    if (typeof mapping.run !== 'string' || mapping.run.trim() === '') {
      errors.push('Each skill mapping must include a non-empty `run` field.')
    } else {
      const loadedSkillUse = parseLoadedSkillUse(mapping.run)
      if (!loadedSkillUse) {
        errors.push('Each skill mapping `run` must load its `id`.')
      } else if (parsedId) {
        const expectedSkillUse = formatSkillUse(
          parsedId.packageName,
          parsedId.skillName,
        )
        if (loadedSkillUse !== expectedSkillUse) {
          errors.push(
            `Skill mapping \`run\` must load matching \`id\` ${expectedSkillUse}.`,
          )
        }
      }

      if (containsLocalPathValue(mapping.run)) {
        errors.push('Skill mapping `run` must not include local file paths.')
      }
    }

    if (typeof mapping.for !== 'string' || mapping.for.trim() === '') {
      errors.push('Each skill mapping must include a non-empty `for` field.')
    } else if (containsLocalPathValue(mapping.for)) {
      errors.push('Skill mapping `for` must not include local file paths.')
    }
  }

  return {
    errors,
    ok: errors.length === 0,
  }
}

export function resolveIntentSkillsBlockTargetPath(
  root: string,
  mappingCount: number,
): string | null {
  if (mappingCount === 0) return null
  return (
    findExistingConfigWithManagedBlock(root)?.filePath ??
    join(root, 'AGENTS.md')
  )
}

function compareNames(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name)
}

function quoteYamlString(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}"`
}

function formatWhen(packageName: string, skill: SkillEntry): string {
  const description = skill.description.replace(/\s+/g, ' ').trim()
  return description || `Use ${packageName} ${skill.name}`
}

export function buildIntentSkillsBlock(
  scanResult: ScanResult,
): IntentSkillsBlockResult {
  const lines = [
    INTENT_SKILLS_START,
    '# TanStack Intent - before editing files, run the matching guidance command.',
    'tanstackIntent:',
  ]
  let mappingCount = 0

  for (const pkg of [...scanResult.packages].sort(compareNames)) {
    for (const skill of [...pkg.skills].sort(compareNames)) {
      if (!isGeneratedMappingSkill(skill)) continue

      mappingCount++
      lines.push(
        `  - id: ${quoteYamlString(formatSkillUse(pkg.name, skill.name))}`,
      )
      lines.push(
        `    run: ${quoteYamlString(
          formatIntentCommand(
            scanResult.packageManager,
            `load ${formatSkillUse(pkg.name, skill.name)}`,
          ),
        )}`,
      )
      lines.push(`    for: ${quoteYamlString(formatWhen(pkg.name, skill))}`)
    }
  }

  if (mappingCount === 0) {
    lines[2] = 'tanstackIntent: []'
  }

  lines.push(INTENT_SKILLS_END)
  return {
    block: `${lines.join('\n')}\n`,
    mappingCount,
  }
}

export function buildIntentSkillGuidanceBlock(
  packageManager: ScanResult['packageManager'] = 'unknown',
): IntentSkillsBlockResult {
  const listCommand = formatIntentCommand(packageManager, 'list')
  const loadCommand = formatIntentCommand(
    packageManager,
    'load <package>#<skill>',
  )

  return {
    block: `${[
      INTENT_SKILLS_START,
      '## Skill Loading',
      '',
      'Before editing files for a substantial task:',
      `- Run \`${listCommand}\` from the workspace root to see available local skills.`,
      `- If a listed skill matches the task, run \`${loadCommand}\` before changing files.`,
      '- Use the loaded `SKILL.md` guidance while making the change.',
      '- Monorepos: when working across packages, run the skill check from the workspace root and prefer the local skill for the package being changed.',
      '- Multiple matches: prefer the most specific local skill for the package or concern you are changing; load additional skills only when the task spans multiple packages or concerns.',
      INTENT_SKILLS_END,
    ].join('\n')}\n`,
    mappingCount: 0,
  }
}

function detectNewline(content: string): string {
  return content.includes('\r\n') ? '\r\n' : '\n'
}

function withNewlineStyle(content: string, newline: string): string {
  return newline === '\n' ? content : content.replace(/\n/g, newline)
}

function findExistingConfigWithManagedBlock(root: string): {
  content: string
  filePath: string
  managedBlock: ManagedBlock
} | null {
  for (const file of SUPPORTED_AGENT_CONFIG_FILES) {
    const filePath = join(root, file)
    if (!existsSync(filePath)) continue

    const content = readFileSync(filePath, 'utf8')
    const { managedBlock, errors, hasMarker } = readManagedBlock(content)
    if (managedBlock) return { content, filePath, managedBlock }
    if (hasMarker) {
      throw new Error(
        `Invalid intent-skills block in ${filePath}: ${errors.join(' ')}`,
      )
    }
  }

  return null
}

function replaceManagedBlock(
  content: string,
  managedBlock: ManagedBlock,
  block: string,
): string {
  const newline = detectNewline(content)
  const styledBlock = withNewlineStyle(block.trimEnd(), newline)
  return `${content.slice(0, managedBlock.start)}${styledBlock}${content.slice(managedBlock.end)}`
}

export function writeIntentSkillsBlock({
  block,
  mappingCount,
  root,
  skipWhenEmpty = true,
}: WriteIntentSkillsBlockOptions): WriteIntentSkillsBlockResult {
  if (mappingCount === 0 && skipWhenEmpty) {
    return {
      mappingCount,
      status: 'skipped',
      targetPath: null,
    }
  }

  const existingTarget = findExistingConfigWithManagedBlock(root)
  const targetPath = existingTarget?.filePath ?? join(root, 'AGENTS.md')

  if (existingTarget) {
    const nextContent = replaceManagedBlock(
      existingTarget.content,
      existingTarget.managedBlock,
      block,
    )
    if (nextContent === existingTarget.content) {
      return {
        mappingCount,
        status: 'unchanged',
        targetPath,
      }
    }

    writeFileSync(targetPath, nextContent)
    return {
      mappingCount,
      status: 'updated',
      targetPath,
    }
  }

  if (existsSync(targetPath)) {
    const currentContent = readFileSync(targetPath, 'utf8')
    const newline = detectNewline(currentContent)
    const separator = currentContent === '' ? '' : newline
    const nextContent = `${withNewlineStyle(block, newline)}${separator}${currentContent}`

    writeFileSync(targetPath, nextContent)
    return {
      mappingCount,
      status: 'updated',
      targetPath,
    }
  }

  mkdirSync(dirname(targetPath), { recursive: true })
  writeFileSync(targetPath, block)
  return {
    mappingCount,
    status: 'created',
    targetPath,
  }
}
