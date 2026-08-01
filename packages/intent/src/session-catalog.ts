import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { homedir, tmpdir, userInfo } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { resolveProjectContext } from './core/project-context.js'
import { computeSkillContentHash } from './core/lockfile/hash.js'
import { containsLocalPath } from './shared/local-path.js'
import { isGeneratedMappingSkill } from './skills/categories.js'
import {
  SESSION_CATALOGUE_MAX_BYTES,
  SESSION_CATALOGUE_MAX_DESCRIPTION_LENGTH,
  SESSION_CATALOGUE_MAX_SKILLS,
  normalizeWhitespace,
  truncateText,
} from './skills/catalogue-contract.js'
import { parseSkillUse } from './skills/use.js'
import { findWorkspacePackages } from './setup/workspace-patterns.js'
import type * as NodePath from 'node:path'
import type { IntentSkillList } from './core/index.js'
import type { ReadFs } from './shared/utils.js'

const CACHE_SCHEMA_VERSION = 5
const MIN_CONTEXT_BYTES = 512
const warnedCacheDirectories = new Set<string>()
const FINGERPRINT_FILES = [
  'package.json',
  'intent.lock',
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

export interface CatalogueVerificationEntry {
  packageRoot: string
  skillPath: string
  contentHash: string
}

export interface SessionCatalogue {
  skills: Array<SessionSkillSummary>
  totalSkillCount: number
  warnings: Array<string>
}

export interface RenderedSessionCatalogue {
  context: string
  skillCount: number
}

export interface DiscoveredSessionCatalogue {
  result: IntentSkillList
  verification: Array<CatalogueVerificationEntry> | null
}

interface IntentSessionCatalogueCache {
  schemaVersion: number
  workspaceRoot: string
  policyRoot: string
  catalogueKey: string
  dependencyFingerprint: string
  catalogue: SessionCatalogue
  verification: Array<CatalogueVerificationEntry>
}

export interface SessionCatalogueResult {
  cachePath: string
  cacheStatus: 'hit' | 'miss' | 'refresh'
  catalogue: SessionCatalogue
}

export function buildSessionCatalogue(
  result: IntentSkillList,
  options: { maxSkills?: number } = {},
): SessionCatalogue {
  const maxSkills = options.maxSkills ?? SESSION_CATALOGUE_MAX_SKILLS
  const allSkills = result.skills
    .filter(isGeneratedMappingSkill)
    .map((skill) => {
      const parsed = parseSkillUse(skill.use)
      const normalizedDescription = normalizeWhitespace(skill.description)
      const description = containsLocalPath(normalizedDescription)
        ? ''
        : truncateText(
            normalizedDescription,
            SESSION_CATALOGUE_MAX_DESCRIPTION_LENGTH,
          )
      return {
        packageName: parsed.packageName,
        summary: {
          id: skill.use,
          description: description || `Use ${skill.use}`,
        },
      }
    })
    .sort((left, right) => compareOrdinal(left.summary.id, right.summary.id))
  return {
    skills: selectSkillsAcrossPackages(allSkills, maxSkills),
    totalSkillCount: allSkills.length,
    warnings: [
      ...new Set(
        result.warnings.filter((warning) =>
          /(?:skill was|skills were) withheld because|Pause and ask the user to run `intent install`/.test(
            warning,
          ),
        ),
      ),
    ],
  }
}

function selectSkillsAcrossPackages(
  skills: Array<{ packageName: string; summary: SessionSkillSummary }>,
  maxSkills: number,
): Array<SessionSkillSummary> {
  const byPackage = new Map<string, Array<SessionSkillSummary>>()
  for (const skill of skills) {
    const packageSkills = byPackage.get(skill.packageName)
    if (packageSkills) packageSkills.push(skill.summary)
    else byPackage.set(skill.packageName, [skill.summary])
  }

  const packages = [...byPackage.entries()].sort(([left], [right]) =>
    compareOrdinal(left, right),
  )
  const selected: Array<SessionSkillSummary> = []
  for (let index = 0; selected.length < maxSkills; index++) {
    let added = false
    for (const [, packageSkills] of packages) {
      const skill = packageSkills[index]
      if (!skill) continue
      selected.push(skill)
      added = true
      if (selected.length === maxSkills) break
    }
    if (!added) break
  }
  return selected
}

export function formatSessionCatalogue(
  catalogue: SessionCatalogue,
  options: { maxBytes?: number; packageName?: string } = {},
): string {
  return renderSessionCatalogue(catalogue, options).context
}

export function renderSessionCatalogue(
  catalogue: SessionCatalogue,
  options: { maxBytes?: number; packageName?: string } = {},
): RenderedSessionCatalogue {
  const maxBytes = options.maxBytes ?? SESSION_CATALOGUE_MAX_BYTES
  if (!Number.isInteger(maxBytes) || maxBytes < MIN_CONTEXT_BYTES) {
    throw new RangeError(
      `Session catalogue maxBytes must be an integer of at least ${MIN_CONTEXT_BYTES}.`,
    )
  }
  const warningLines = catalogue.warnings.flatMap((warning, index) =>
    index === 0 ? ['', 'Catalog warnings:', `- ${warning}`] : [`- ${warning}`],
  )
  if (catalogue.skills.length === 0) {
    const empty = options.packageName
      ? `No available Intent skills for ${options.packageName}.`
      : 'No available Intent skills.'
    return { context: [empty, ...warningLines].join('\n'), skillCount: 0 }
  }

  const baseLines = ['Available Intent skills:', '']
  const footerLines = [
    ...warningLines,
    '',
    'Load a matching skill with `intent load <id>`. If none match, continue normally.',
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
      ...(omitted > 0
        ? [formatOmittedSkills(omitted, options.packageName)]
        : []),
      ...footerLines,
    ]
    if (!fits(candidateLines, maxBytes)) break
    skillLines.push(nextSkillLines.at(-1)!)
  }

  const omitted = catalogue.totalSkillCount - skillLines.length
  const lines = [
    ...baseLines,
    ...skillLines,
    ...(omitted > 0 ? [formatOmittedSkills(omitted, options.packageName)] : []),
    ...footerLines,
  ]
  if (!fits(lines, maxBytes)) {
    throw new RangeError(
      'Session catalogue maxBytes must be large enough for complete guidance.',
    )
  }
  return { context: lines.join('\n'), skillCount: skillLines.length }
}

export function resolveCatalogueWorkspaceRoot(cwd: string): string {
  const context = resolveProjectContext({ cwd })
  return normalizeRoot(context.workspaceRoot ?? context.packageRoot ?? cwd)
}

export async function getSessionCatalogue(options: {
  cacheDir?: string
  catalogueKey?: string
  discover: () =>
    | DiscoveredSessionCatalogue
    | Promise<DiscoveredSessionCatalogue>
  refresh?: boolean
  root: string
  policyRoot?: string
  readFs?: ReadFs
}): Promise<SessionCatalogueResult> {
  const {
    cacheDir: suppliedCacheDir,
    catalogueKey = 'all',
    discover,
    refresh = false,
    root,
    policyRoot = root,
    readFs,
  } = options
  const cache = prepareCacheDirectory(suppliedCacheDir)
  const workspaceRoot = normalizeRoot(root)
  const normalizedPolicyRoot = normalizeRoot(policyRoot)
  const dependencyFingerprint = computeCatalogueFingerprint(
    workspaceRoot,
    normalizedPolicyRoot,
  )
  const cachePath = join(
    cache.path,
    `${createHash('sha256').update(workspaceRoot).update('\0').update(normalizedPolicyRoot).update('\0').update(catalogueKey).digest('hex')}.json`,
  )
  const cached = cache.enabled ? readCache(cachePath) : null

  if (
    !refresh &&
    cached?.workspaceRoot === workspaceRoot &&
    cached.policyRoot === normalizedPolicyRoot &&
    cached.catalogueKey === catalogueKey &&
    cached.dependencyFingerprint === dependencyFingerprint &&
    verifyCatalogueContent(cached.verification, readFs)
  ) {
    return {
      cachePath,
      cacheStatus: 'hit',
      catalogue: cached.catalogue,
    }
  }

  const refreshed = await discover()
  const catalogue = buildSessionCatalogue(refreshed.result)
  if (cache.enabled && refreshed.verification !== null) {
    const entry: IntentSessionCatalogueCache = {
      schemaVersion: CACHE_SCHEMA_VERSION,
      workspaceRoot,
      policyRoot: normalizedPolicyRoot,
      catalogueKey,
      dependencyFingerprint,
      catalogue,
      verification: refreshed.verification,
    }
    writeCache(cachePath, entry)
  }

  return {
    cachePath,
    cacheStatus: cached ? 'refresh' : 'miss',
    catalogue,
  }
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

  for (const file of [...new Set(files)].sort(compareOrdinal)) {
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

function verifyCatalogueContent(
  entries: ReadonlyArray<CatalogueVerificationEntry>,
  fs?: ReadFs,
): boolean {
  try {
    return entries.every(
      (entry) =>
        computeSkillContentHash({
          packageRoot: entry.packageRoot,
          skillDir: entry.skillPath,
          fs,
        }) === entry.contentHash,
    )
  } catch {
    return false
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

export function policyManifestPaths(
  workspaceRoot: string,
  policyRoot: string,
  pathApi: Pick<
    typeof NodePath,
    'dirname' | 'isAbsolute' | 'join' | 'relative'
  > = { dirname, isAbsolute, join, relative },
): Array<string> {
  const relativePolicyRoot = pathApi.relative(workspaceRoot, policyRoot)
  if (
    relativePolicyRoot.split(/[\\/]/, 1)[0] === '..' ||
    pathApi.isAbsolute(relativePolicyRoot)
  ) {
    return [pathApi.join(policyRoot, 'package.json')]
  }

  const manifests: Array<string> = []
  let directory = policyRoot
  while (pathApi.relative(workspaceRoot, directory) !== '') {
    manifests.push(pathApi.join(directory, 'package.json'))
    const parent = pathApi.dirname(directory)
    if (parent === directory) {
      return [pathApi.join(policyRoot, 'package.json')]
    }
    directory = parent
  }
  manifests.push(pathApi.join(workspaceRoot, 'package.json'))
  return manifests
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function formatOmittedSkills(count: number, packageName?: string): string {
  const subject = `${count} additional ${count === 1 ? 'skill' : 'skills'} omitted`
  return packageName
    ? `- ${subject} from ${packageName}; load a known skill ID directly if needed.`
    : `- ${subject}; run \`intent catalog <package>\` for the relevant package.`
}

function fits(lines: Array<string>, maxBytes: number): boolean {
  return Buffer.byteLength(lines.join('\n')) <= maxBytes
}

function defaultCacheDirectory(): string {
  const tempRoot = realpathSync.native(tmpdir())
  const userKey =
    typeof process.getuid === 'function'
      ? String(process.getuid())
      : createHash('sha256')
          .update(userInfo().username)
          .update('\0')
          .update(homedir())
          .digest('hex')
          .slice(0, 12)
  return join(tempRoot, `tanstack-intent-${userKey}-catalogues`)
}

function prepareCacheDirectory(suppliedPath?: string): {
  path: string
  enabled: boolean
} {
  let path = suppliedPath
  try {
    const isDefault = path === undefined
    path = suppliedPath ?? defaultCacheDirectory()
    if (typeof process.getuid === 'function' && isDefault) {
      const tempRoot = lstatSync(dirname(path))
      const isPrivateOwnerDirectory =
        tempRoot.uid === process.getuid() && (tempRoot.mode & 0o022) === 0
      if (
        tempRoot.isSymbolicLink() ||
        !tempRoot.isDirectory() ||
        (!isPrivateOwnerDirectory && (tempRoot.mode & 0o1000) === 0)
      ) {
        throw new Error('Unsafe temporary directory')
      }
    }

    mkdirSync(path, { recursive: true, mode: 0o700 })
    const initial = lstatSync(path)
    if (initial.isSymbolicLink() || !initial.isDirectory()) {
      throw new Error('Unsafe cache directory')
    }

    if (typeof process.getuid === 'function') {
      if (initial.uid !== process.getuid()) {
        throw new Error('Unsafe cache directory owner')
      }
      if (isDefault && (initial.mode & 0o077) !== 0) {
        chmodSync(path, 0o700)
        const tightened = lstatSync(path)
        if (
          tightened.dev !== initial.dev ||
          tightened.ino !== initial.ino ||
          tightened.isSymbolicLink() ||
          !tightened.isDirectory() ||
          tightened.uid !== process.getuid() ||
          (tightened.mode & 0o077) !== 0
        ) {
          throw new Error('Cache directory changed while securing it')
        }
      } else if (!isDefault && (initial.mode & 0o022) !== 0) {
        throw new Error('Writable cache directory')
      }
    }

    return { path, enabled: true }
  } catch {
    path ??= join(tmpdir(), 'tanstack-intent-catalogues-disabled')
    if (!warnedCacheDirectories.has(path)) {
      warnedCacheDirectories.add(path)
      process.stderr.write(
        `[intent catalog] rejected cache directory ${path}; caching is disabled.\n`,
      )
    }
    return { path, enabled: false }
  }
}

function readCache(path: string): IntentSessionCatalogueCache | null {
  let descriptor: number | undefined
  try {
    const flags =
      typeof process.getuid === 'function'
        ? constants.O_RDONLY | constants.O_NOFOLLOW
        : constants.O_RDONLY
    descriptor = openSync(path, flags)
    const file = fstatSync(descriptor)
    if (
      !file.isFile() ||
      (typeof process.getuid === 'function' &&
        (file.uid !== process.getuid() || (file.mode & 0o022) !== 0))
    ) {
      return null
    }
    const value = JSON.parse(readFileSync(descriptor, 'utf8')) as unknown
    return isCacheEntry(value) ? value : null
  } catch {
    return null
  } finally {
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor)
      } catch {}
    }
  }
}

function isCacheEntry(value: unknown): value is IntentSessionCatalogueCache {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<IntentSessionCatalogueCache>
  return (
    entry.schemaVersion === CACHE_SCHEMA_VERSION &&
    typeof entry.workspaceRoot === 'string' &&
    typeof entry.policyRoot === 'string' &&
    typeof entry.catalogueKey === 'string' &&
    typeof entry.dependencyFingerprint === 'string' &&
    isCatalogue(entry.catalogue) &&
    Array.isArray(entry.verification) &&
    entry.verification.every(isVerificationEntry)
  )
}

function isCatalogue(value: unknown): value is SessionCatalogue {
  if (!value || typeof value !== 'object') return false
  const catalogue = value as Partial<SessionCatalogue>
  return (
    Array.isArray(catalogue.skills) &&
    catalogue.skills.every(isSkillSummary) &&
    typeof catalogue.totalSkillCount === 'number' &&
    Array.isArray(catalogue.warnings) &&
    catalogue.warnings.every((warning) => typeof warning === 'string')
  )
}

function isSkillSummary(value: unknown): value is SessionSkillSummary {
  if (!value || typeof value !== 'object') return false
  const skill = value as Partial<SessionSkillSummary>
  return typeof skill.id === 'string' && typeof skill.description === 'string'
}

function isVerificationEntry(
  value: unknown,
): value is CatalogueVerificationEntry {
  if (!value || typeof value !== 'object') return false
  const entry = value as Partial<CatalogueVerificationEntry>
  return (
    typeof entry.packageRoot === 'string' &&
    typeof entry.skillPath === 'string' &&
    typeof entry.contentHash === 'string'
  )
}

function writeCache(path: string, entry: IntentSessionCatalogueCache): void {
  const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(entry)}\n`, {
      flag: 'wx',
      mode: 0o600,
    })
    renameSync(temporaryPath, path)
  } catch {
    try {
      rmSync(temporaryPath, { force: true })
    } catch {}
  }
}
