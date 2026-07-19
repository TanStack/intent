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
import { isGeneratedMappingSkill } from './skills/categories.js'
import { parseSkillUse } from './skills/use.js'
import { findWorkspacePackages } from './setup/workspace-patterns.js'
import type { IntentSkillList } from './core/index.js'

const CACHE_SCHEMA_VERSION = 1
const DEFAULT_MAX_SKILLS = 50
const MAX_DESCRIPTION_LENGTH = 180
const MAX_WARNING_COUNT = 10
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
const LOCAL_PATH_PATTERN =
  /(?:^|\s)(?:[A-Za-z]:[\\/]|\/[^\s]*|[^\s]*(?:node_modules|\.pnpm|\.bun|\.yarn|\.intent)[\\/])/i

interface SessionSkillSummary {
  id: string
  description: string
  type?: string
  packageName?: string
}

export interface SessionCatalogue {
  packageCount: number
  skills: Array<SessionSkillSummary>
  totalSkillCount: number
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
      const description = normalizeDescription(skill.description)
      return {
        id: skill.use,
        description: description || `Use ${skill.use}`,
        packageName: skill.packageName,
        ...(skill.type ? { type: skill.type } : {}),
      }
    })
    .sort((left, right) => left.id.localeCompare(right.id))
  const warnings = [...result.warnings, ...result.notices]
    .map(normalizeWhitespace)
    .filter((warning) => warning && !LOCAL_PATH_PATTERN.test(warning))
    .slice(0, MAX_WARNING_COUNT)

  return {
    packageCount: result.packages.length,
    skills: allSkills.slice(0, maxSkills),
    totalSkillCount: allSkills.length,
    truncated: allSkills.length > maxSkills,
    warnings,
  }
}

export function formatSessionCatalogue(catalogue: SessionCatalogue): string {
  const warningBlock = formatWarnings(catalogue.warnings)
  if (catalogue.skills.length === 0) {
    return [
      'TanStack Intent: no available skills for this workspace.',
      warningBlock,
    ]
      .filter(Boolean)
      .join('\n\n')
  }

  const omitted = catalogue.totalSkillCount - catalogue.skills.length
  const lines = [
    `TanStack Intent: ${catalogue.totalSkillCount} available ${catalogue.totalSkillCount === 1 ? 'skill' : 'skills'}.`,
    'Before substantial work, check this catalogue for a clear task match. If one matches, run `intent load <package>#<skill>` before editing relevant files. If no skill clearly matches, continue normally.',
    'Do not run `intent list`; this catalogue is already current for the workspace.',
    '',
    ...catalogue.skills.map((skill) => `- ${skill.id}: ${skill.description}`),
  ]

  if (omitted > 0) {
    lines.push(
      `- ${omitted} additional ${omitted === 1 ? 'skill' : 'skills'} omitted; narrow the catalogue with package.json intent.skills or intent.exclude.`,
    )
  }
  if (warningBlock) lines.push('', warningBlock)
  return lines.join('\n')
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

export function getSessionCatalogue({
  cacheDir = join(tmpdir(), 'tanstack-intent', 'catalogues'),
  discover,
  refresh = false,
  root,
  policyRoot = root,
}: {
  cacheDir?: string
  discover: () => IntentSkillList
  refresh?: boolean
  root: string
  policyRoot?: string
}): SessionCatalogueResult {
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

  const catalogue = buildSessionCatalogue(discover())
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

function normalizeDescription(value: string): string {
  const normalized = normalizeWhitespace(value)
  if (normalized.length <= MAX_DESCRIPTION_LENGTH) return normalized
  return `${normalized.slice(0, MAX_DESCRIPTION_LENGTH - 3).trimEnd()}...`
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

function formatWarnings(warnings: Array<string>): string {
  if (warnings.length === 0) return ''
  return `Warnings:\n${warnings.map((warning) => `- ${warning}`).join('\n')}`
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
