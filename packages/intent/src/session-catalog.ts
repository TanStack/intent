import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { resolveProjectContext } from './core/project-context.js'
import { containsLocalPath } from './shared/local-path.js'
import { isGeneratedMappingSkill } from './skills/categories.js'
import { parseSkillUse } from './skills/use.js'
import { findWorkspacePackages } from './setup/workspace-patterns.js'
import type { IntentSkillList } from './core/index.js'

const CACHE_SCHEMA_VERSION = 1
const DEFAULT_MAX_CONTEXT_BYTES = 8_000
const DEFAULT_MAX_SKILLS = 50
const MIN_CONTEXT_BYTES = 512
const MAX_DESCRIPTION_LENGTH = 180
const MAX_WARNING_COUNT = 10
const MAX_WARNING_LENGTH = 300
const FINGERPRINT_FILES = [
  'package.json',
  'pnpm-lock.yaml',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'bun.lock',
  'bun.lockb',
  'pnpm-workspace.yaml',
  'deno.json',
  'deno.jsonc',
  'deno.lock',
]

interface SessionSkillSummary {
  id: string
  description: string
}

export interface SessionCatalogue {
  packageCount: number
  skills: Array<SessionSkillSummary>
  totalSkillCount: number
  totalWarningCount: number
  truncated: boolean
  warnings: Array<string>
}

interface IntentSessionCatalogueCache {
  schemaVersion: number
  workspaceRoot: string
  policyRoot: string
  dependencyFingerprint: string
  generatedAt: string
  catalogue: SessionCatalogue
}

export interface SessionCatalogueResult {
  cachePath: string
  cacheStatus: 'hit' | 'miss' | 'refresh'
  catalogue: SessionCatalogue
  dependencyFingerprint: string
  workspaceRoot: string
}

export function buildSessionCatalogue(
  result: IntentSkillList,
  options: { maxSkills?: number } = {},
): SessionCatalogue {
  const maxSkills = options.maxSkills ?? DEFAULT_MAX_SKILLS
  const allSkills = result.skills
    .filter(isGeneratedMappingSkill)
    .map((skill): SessionSkillSummary => {
      parseSkillUse(skill.use)
      const normalizedDescription = normalizeWhitespace(skill.description)
      const description = containsLocalPath(normalizedDescription)
        ? ''
        : truncateText(normalizedDescription, MAX_DESCRIPTION_LENGTH)
      return {
        id: skill.use,
        description: description || `Use ${skill.use}`,
      }
    })
    .sort((left, right) => compareOrdinal(left.id, right.id))
  const allWarnings = [...result.warnings, ...result.notices]
    .map(normalizeWhitespace)
    .filter((warning) => warning && !containsLocalPath(warning))
    .map((warning) => truncateText(warning, MAX_WARNING_LENGTH))

  return {
    packageCount: result.packages.length,
    skills: allSkills.slice(0, maxSkills),
    totalSkillCount: allSkills.length,
    totalWarningCount: allWarnings.length,
    truncated: allSkills.length > maxSkills,
    warnings: allWarnings.slice(0, MAX_WARNING_COUNT),
  }
}

export function formatSessionCatalogue(
  catalogue: SessionCatalogue,
  options: { maxBytes?: number } = {},
): string {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_CONTEXT_BYTES
  if (!Number.isInteger(maxBytes) || maxBytes < MIN_CONTEXT_BYTES) {
    throw new RangeError(
      `Session catalogue maxBytes must be an integer of at least ${MIN_CONTEXT_BYTES}.`,
    )
  }
  if (catalogue.skills.length === 0) {
    return fitWarnings(
      ['TanStack Intent: no available skills for this workspace.'],
      catalogue.warnings,
      catalogue.totalWarningCount,
      maxBytes,
    )
  }

  const baseLines = [
    `TanStack Intent: ${catalogue.totalSkillCount} available ${catalogue.totalSkillCount === 1 ? 'skill' : 'skills'}.`,
    'Before substantial work, check this catalogue for a clear task match. If one matches, run `intent load <package>#<skill>` before editing relevant files. If no skill clearly matches, continue normally.',
    'Do not run `intent list`; this catalogue is already current for the workspace.',
    '',
  ]
  const skillLines: Array<string> = []

  for (const skill of catalogue.skills) {
    const nextSkillLines = [
      ...skillLines,
      `- ${skill.id}: ${skill.description}`,
    ]
    const omitted = catalogue.totalSkillCount - nextSkillLines.length
    const candidateLines = [
      ...baseLines,
      ...nextSkillLines,
      ...(omitted > 0 ? [formatOmittedSkills(omitted)] : []),
    ]
    if (!fits(candidateLines, maxBytes)) break
    skillLines.push(nextSkillLines.at(-1)!)
  }

  const omitted = catalogue.totalSkillCount - skillLines.length
  const lines = [
    ...baseLines,
    ...skillLines,
    ...(omitted > 0 ? [formatOmittedSkills(omitted)] : []),
  ]
  if (!fits(lines, maxBytes)) {
    throw new RangeError(
      `Session catalogue maxBytes must be large enough for complete guidance.`,
    )
  }
  return fitWarnings(
    lines,
    catalogue.warnings,
    catalogue.totalWarningCount,
    maxBytes,
  )
}

export function resolveCatalogueWorkspaceRoot(cwd: string): string {
  const context = resolveProjectContext({ cwd })
  return normalizeRoot(context.workspaceRoot ?? context.packageRoot ?? cwd)
}

function computeCatalogueFingerprint(root: string, policyRoot: string): string {
  const normalizedRoot = normalizeRoot(root)
  const packageRoots = [
    normalizedRoot,
    ...findWorkspacePackages(normalizedRoot),
  ]
  const files = [
    ...FINGERPRINT_FILES.map((file) => join(normalizedRoot, file)),
    ...packageRoots.map((packageRoot) => join(packageRoot, 'package.json')),
    ...policyManifestPaths(normalizedRoot, policyRoot),
  ]
  const hash = createHash('sha256')
  hash.update(String(CACHE_SCHEMA_VERSION))

  for (const file of [...new Set(files)].sort()) {
    hash.update('\0')
    hash.update(file.slice(normalizedRoot.length).replace(/\\/g, '/'))
    hash.update('\0')
    try {
      hash.update(readFileSync(file))
    } catch {
      hash.update('<missing>')
    }
  }

  return hash.digest('hex')
}

export async function getSessionCatalogue({
  cacheDir = join(tmpdir(), 'tanstack-intent', 'catalogues'),
  discover,
  refresh = false,
  root,
  policyRoot = root,
}: {
  cacheDir?: string
  discover: () => IntentSkillList | Promise<IntentSkillList>
  refresh?: boolean
  root: string
  policyRoot?: string
}): Promise<SessionCatalogueResult> {
  const workspaceRoot = normalizeRoot(root)
  const normalizedPolicyRoot = normalizeRoot(policyRoot)
  const dependencyFingerprint = computeCatalogueFingerprint(
    workspaceRoot,
    normalizedPolicyRoot,
  )
  const cachePath = join(
    cacheDir,
    `${createHash('sha256').update(workspaceRoot).update('\0').update(normalizedPolicyRoot).digest('hex')}.json`,
  )
  const cached = readCache(cachePath)

  if (
    !refresh &&
    cached?.workspaceRoot === workspaceRoot &&
    cached.policyRoot === normalizedPolicyRoot &&
    cached.dependencyFingerprint === dependencyFingerprint
  ) {
    return {
      cachePath,
      cacheStatus: 'hit',
      catalogue: cached.catalogue,
      dependencyFingerprint,
      workspaceRoot,
    }
  }

  const catalogue = buildSessionCatalogue(await discover())
  const entry: IntentSessionCatalogueCache = {
    schemaVersion: CACHE_SCHEMA_VERSION,
    workspaceRoot,
    policyRoot: normalizedPolicyRoot,
    dependencyFingerprint,
    generatedAt: new Date().toISOString(),
    catalogue,
  }
  writeCache(cachePath, entry)

  return {
    cachePath,
    cacheStatus: cached ? 'refresh' : 'miss',
    catalogue,
    dependencyFingerprint,
    workspaceRoot,
  }
}

function normalizeRoot(root: string): string {
  const resolved = resolve(root)
  const real = existsSync(resolved) ? realpathSync.native(resolved) : resolved
  const normalized = real.replace(/\\/g, '/')
  return /^[A-Z]:/.test(normalized)
    ? `${normalized[0]!.toLowerCase()}${normalized.slice(1)}`
    : normalized
}

function policyManifestPaths(
  workspaceRoot: string,
  policyRoot: string,
): Array<string> {
  const relativePolicyRoot = relative(workspaceRoot, policyRoot)
  if (
    relativePolicyRoot.startsWith('..') ||
    relativePolicyRoot.startsWith('/')
  ) {
    return [join(policyRoot, 'package.json')]
  }

  const manifests: Array<string> = []
  let directory = policyRoot
  while (directory !== workspaceRoot) {
    manifests.push(join(directory, 'package.json'))
    directory = dirname(directory)
  }
  manifests.push(join(workspaceRoot, 'package.json'))
  return manifests
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function truncateText(value: string, maxLength: number): string {
  const codePoints = [...value]
  if (codePoints.length <= maxLength) return value
  return `${codePoints
    .slice(0, maxLength - 3)
    .join('')
    .trimEnd()}...`
}

function formatOmittedSkills(count: number): string {
  return `- ${count} additional ${count === 1 ? 'skill' : 'skills'} omitted; narrow the catalogue with package.json intent.skills or intent.exclude.`
}

function fitWarnings(
  lines: Array<string>,
  warnings: Array<string>,
  totalWarningCount: number,
  maxBytes: number,
): string {
  const warningLines: Array<string> = []

  for (const warning of warnings) {
    const nextWarningLines = [...warningLines, `- ${warning}`]
    const omitted = totalWarningCount - nextWarningLines.length
    const candidateLines = [
      ...lines,
      '',
      'Warnings:',
      ...nextWarningLines,
      ...(omitted > 0 ? [formatOmittedWarnings(omitted)] : []),
    ]
    if (!fits(candidateLines, maxBytes)) break
    warningLines.push(nextWarningLines.at(-1)!)
  }

  const omitted = totalWarningCount - warningLines.length
  if (warningLines.length === 0 && omitted === 0) return lines.join('\n')

  const outputLines = [
    ...lines,
    '',
    'Warnings:',
    ...warningLines,
    ...(omitted > 0 ? [formatOmittedWarnings(omitted)] : []),
  ]
  if (!fits(outputLines, maxBytes)) {
    return lines.join('\n')
  }
  return outputLines.join('\n')
}

function formatOmittedWarnings(count: number): string {
  return `- ${count} additional ${count === 1 ? 'warning' : 'warnings'} omitted.`
}

function fits(lines: Array<string>, maxBytes: number): boolean {
  return Buffer.byteLength(lines.join('\n')) <= maxBytes
}

function readCache(path: string): IntentSessionCatalogueCache | null {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as unknown
    return isCacheEntry(value) ? value : null
  } catch {
    return null
  }
}

function isCacheEntry(value: unknown): value is IntentSessionCatalogueCache {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<IntentSessionCatalogueCache>
  return (
    entry.schemaVersion === CACHE_SCHEMA_VERSION &&
    typeof entry.workspaceRoot === 'string' &&
    typeof entry.policyRoot === 'string' &&
    typeof entry.dependencyFingerprint === 'string' &&
    typeof entry.generatedAt === 'string' &&
    isCatalogue(entry.catalogue)
  )
}

function isCatalogue(value: unknown): value is SessionCatalogue {
  if (!value || typeof value !== 'object') return false
  const catalogue = value as Partial<SessionCatalogue>
  return (
    Array.isArray(catalogue.skills) &&
    typeof catalogue.packageCount === 'number' &&
    catalogue.skills.every(isSkillSummary) &&
    typeof catalogue.totalSkillCount === 'number' &&
    typeof catalogue.totalWarningCount === 'number' &&
    typeof catalogue.truncated === 'boolean' &&
    Array.isArray(catalogue.warnings) &&
    catalogue.warnings.every((warning) => typeof warning === 'string')
  )
}

function isSkillSummary(value: unknown): value is SessionSkillSummary {
  if (!value || typeof value !== 'object') return false
  const skill = value as Partial<SessionSkillSummary>
  return typeof skill.id === 'string' && typeof skill.description === 'string'
}

function writeCache(path: string, entry: IntentSessionCatalogueCache): void {
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`
  try {
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(temporaryPath, `${JSON.stringify(entry)}\n`, { flag: 'wx' })
    renameSync(temporaryPath, path)
  } catch {
    try {
      rmSync(temporaryPath, { force: true })
    } catch {
      return
    }
  }
}
