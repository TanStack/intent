import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { resolveProjectContext } from './core/project-context.js'
import {
  ResolveSkillUseError,
  resolveSkillUse,
  type ResolveSkillResult,
} from './resolver.js'
import { formatSkillUse, parseSkillUse } from './skill-use.js'
import { scanForIntents, scanIntentPackageAtRoot } from './scanner.js'
import { resolveWorkspacePackages } from './workspace-patterns.js'
import { getDeps, resolveDepDir, toPosixPath } from './utils.js'
import type { IntentPackage, ScanOptions, VersionConflict } from './types.js'

export interface IntentCoreOptions {
  cwd?: string
  global?: boolean
  globalOnly?: boolean
  exclude?: Array<string>
}

export interface IntentSkillSummary {
  use: string
  packageName: string
  packageVersion: string
  packageSource: IntentPackage['source']
  skillName: string
  description: string
  type?: string
  framework?: string
}

export interface IntentPackageSummary {
  name: string
  version: string
  source: IntentPackage['source']
  skillCount: number
}

export interface IntentSkillList {
  skills: Array<IntentSkillSummary>
  packages: Array<IntentPackageSummary>
  warnings: Array<string>
  conflicts: Array<VersionConflict>
}

export interface LoadedIntentSkill {
  content: string
  path: string
  packageRoot: string
  packageName: string
  skillName: string
  version: string
  source: IntentPackage['source']
  warnings: Array<string>
  conflict: VersionConflict | null
}

export class IntentCoreError extends Error {
  readonly code:
    | 'invalid-options'
    | 'invalid-skill-use'
    | 'package-not-found'
    | 'package-excluded'
    | 'skill-not-found'
    | 'skill-path-outside-package'
    | 'skill-file-not-found'

  constructor(code: IntentCoreError['code'], message: string) {
    super(message)
    this.name = 'IntentCoreError'
    this.code = code
  }
}

function normalizeExcludePatterns(value: unknown): Array<string> {
  if (!Array.isArray(value)) return []

  return value
    .filter((pattern): pattern is string => typeof pattern === 'string')
    .map((pattern) => pattern.trim())
    .filter(Boolean)
}

function toScanOptions(options: IntentCoreOptions): ScanOptions {
  if (options.global && options.globalOnly) {
    throw new IntentCoreError(
      'invalid-options',
      'Use either global or globalOnly, not both.',
    )
  }

  if (options.globalOnly) {
    return { scope: 'global' }
  }

  if (options.global) {
    return { scope: 'local-and-global' }
  }

  return { scope: 'local' }
}

function withCwd<T>(cwd: string | undefined, callback: () => T): T {
  if (!cwd) return callback()

  const originalCwd = process.cwd()
  process.chdir(cwd)
  try {
    return callback()
  } finally {
    process.chdir(originalCwd)
  }
}

function isWithinOrEqual(path: string, parentDir: string): boolean {
  const rel = relative(parentDir, path)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function readPackageJson(dir: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as Record<
      string,
      unknown
    >
  } catch {
    return null
  }
}

function readPackageExcludes(dir: string): Array<string> {
  const pkg = readPackageJson(dir)
  const intent = pkg?.intent
  if (!intent || typeof intent !== 'object') return []

  return normalizeExcludePatterns((intent as Record<string, unknown>).exclude)
}

function getConfigExcludePatterns(cwd: string): Array<string> {
  const context = resolveProjectContext({ cwd })
  const root = context.workspaceRoot ?? context.packageRoot ?? cwd
  const dirs: Array<string> = []
  let dir = cwd

  while (isWithinOrEqual(dir, root)) {
    dirs.push(dir)
    if (dir === root) break

    const next = dirname(dir)
    if (next === dir) break
    dir = next
  }

  return dirs.reverse().flatMap(readPackageExcludes)
}

function getEffectiveExcludePatterns(
  options: IntentCoreOptions,
): Array<string> {
  return [
    ...getConfigExcludePatterns(process.cwd()),
    ...normalizeExcludePatterns(options.exclude),
  ]
}

function globToRegExp(pattern: string): RegExp {
  const source = pattern
    .split('*')
    .map((part) => part.replace(/[\\^$+?.()|[\]{}]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${source}$`)
}

function matchesPackageGlob(packageName: string, pattern: string): boolean {
  return pattern.includes('*')
    ? globToRegExp(pattern).test(packageName)
    : packageName === pattern
}

function isPackageExcluded(
  packageName: string,
  patterns: Array<string>,
): boolean {
  return patterns.some((pattern) => matchesPackageGlob(packageName, pattern))
}

function warningMentionsPackage(warning: string, packageName: string): boolean {
  const idx = warning.indexOf(packageName)
  if (idx === -1) return false

  const after = warning[idx + packageName.length]
  return after === undefined || /[^a-zA-Z0-9_-]/.test(after)
}

interface WorkspacePackageInfo {
  dir: string
  name: string | null
  packageJson: Record<string, unknown>
}

function readWorkspacePackageInfos(cwd: string): Array<WorkspacePackageInfo> {
  const context = resolveProjectContext({ cwd })
  const dirs = new Set<string>()

  if (context.packageRoot) {
    dirs.add(context.packageRoot)
  }

  if (context.workspaceRoot) {
    dirs.add(context.workspaceRoot)

    for (const dir of resolveWorkspacePackages(
      context.workspaceRoot,
      context.workspacePatterns,
    )) {
      dirs.add(dir)
    }
  }

  return [...dirs].flatMap((dir) => {
    const packageJson = readPackageJson(dir)
    if (!packageJson) return []

    return [
      {
        dir,
        name: typeof packageJson.name === 'string' ? packageJson.name : null,
        packageJson,
      },
    ]
  })
}

function addCandidateDir(
  candidates: Array<string>,
  seen: Set<string>,
  dir: string | null,
): void {
  if (!dir) return

  const key = resolve(dir)
  if (seen.has(key)) return

  seen.add(key)
  candidates.push(dir)
}

function findVisibleDependencyDir(
  packageName: string,
  fromDir: string,
): string | null {
  let dir = fromDir

  while (true) {
    const candidate = join(dir, 'node_modules', packageName)
    if (existsSync(join(candidate, 'package.json'))) return candidate

    const next = dirname(dir)
    if (next === dir) return null
    dir = next
  }
}

function resolveDependencyPackageDir(
  packageName: string,
  fromDir: string,
): string | null {
  return (
    findVisibleDependencyDir(packageName, fromDir) ??
    resolveDepDir(packageName, fromDir)
  )
}

function workspacePackageDeclaresDependency(
  packageJson: Record<string, unknown>,
  packageName: string,
): boolean {
  return getDeps(packageJson).includes(packageName)
}

function getLoadFastPathCandidateDirs(
  packageName: string,
): Array<string> {
  const cwd = process.cwd()
  const context = resolveProjectContext({ cwd })
  const workspacePackages = readWorkspacePackageInfos(cwd)
  const candidates: Array<string> = []
  const seen = new Set<string>()

  for (const pkg of workspacePackages) {
    if (pkg.name === packageName) {
      addCandidateDir(candidates, seen, pkg.dir)
    }
  }

  addCandidateDir(
    candidates,
    seen,
    resolveDependencyPackageDir(
      packageName,
      context.packageRoot ?? context.workspaceRoot ?? cwd,
    ),
  )

  if (context.workspaceRoot && context.workspaceRoot !== context.packageRoot) {
    addCandidateDir(
      candidates,
      seen,
      resolveDependencyPackageDir(packageName, context.workspaceRoot),
    )
  }

  for (const pkg of workspacePackages) {
    if (!workspacePackageDeclaresDependency(pkg.packageJson, packageName)) {
      continue
    }

    addCandidateDir(
      candidates,
      seen,
      resolveDependencyPackageDir(packageName, pkg.dir),
    )
  }

  return candidates
}

function resolveSkillUseFastPath(
  parsedUse: ReturnType<typeof parseSkillUse>,
  options: IntentCoreOptions,
): ResolveSkillResult | null {
  if (options.globalOnly) return null

  for (const packageRoot of getLoadFastPathCandidateDirs(
    parsedUse.packageName,
  )) {
    const scanned = scanIntentPackageAtRoot(packageRoot, {
      fallbackName: parsedUse.packageName,
      projectRoot: process.cwd(),
    })
    const pkg = scanned.package
    if (!pkg || pkg.name !== parsedUse.packageName) continue

    const skill = pkg.skills.find(
      (candidate) => candidate.name === parsedUse.skillName,
    )
    if (!skill) continue

    return {
      packageName: pkg.name,
      skillName: skill.name,
      path: skill.path,
      source: pkg.source,
      version: pkg.version,
      packageRoot: pkg.packageRoot,
      warnings: scanned.warnings.filter((warning) =>
        warningMentionsPackage(warning, pkg.name),
      ),
      conflict: null,
    }
  }

  return null
}

export function listIntentSkills(
  options: IntentCoreOptions = {},
): IntentSkillList {
  return withCwd(options.cwd, () => {
    const scanResult = scanForIntents(undefined, toScanOptions(options))
    const excludePatterns = getEffectiveExcludePatterns(options)
    const excludedPackages = scanResult.packages
      .filter((pkg) => isPackageExcluded(pkg.name, excludePatterns))
      .map((pkg) => pkg.name)
    const packages = scanResult.packages.filter(
      (pkg) => !isPackageExcluded(pkg.name, excludePatterns),
    )
    const skills = packages.flatMap((pkg) =>
      pkg.skills.map((skill): IntentSkillSummary => {
        return {
          use: formatSkillUse(pkg.name, skill.name),
          packageName: pkg.name,
          packageVersion: pkg.version,
          packageSource: pkg.source,
          skillName: skill.name,
          description: skill.description,
          type: skill.type,
          framework: skill.framework,
        }
      }),
    )

    return {
      skills,
      packages: packages.map((pkg) => ({
        name: pkg.name,
        version: pkg.version,
        source: pkg.source,
        skillCount: pkg.skills.length,
      })),
      warnings: scanResult.warnings.filter(
        (warning) =>
          !excludedPackages.some((packageName) =>
            warningMentionsPackage(warning, packageName),
          ),
      ),
      conflicts: scanResult.conflicts.filter(
        (conflict) => !isPackageExcluded(conflict.packageName, excludePatterns),
      ),
    }
  })
}

function resolveFromCwd(path: string): string {
  return resolve(process.cwd(), path)
}

function isPathInsidePackageRoot(path: string, packageRoot: string): boolean {
  const relativePath = relative(
    resolveFromCwd(packageRoot),
    resolveFromCwd(path),
  )
  return (
    relativePath === '' ||
    (!relativePath.startsWith('..') && !isAbsolute(relativePath))
  )
}

function splitDestinationSuffix(destination: string): {
  pathPart: string
  suffix: string
} {
  const hashIndex = destination.indexOf('#')
  const queryIndex = destination.indexOf('?')
  const suffixIndex =
    hashIndex === -1
      ? queryIndex
      : queryIndex === -1
        ? hashIndex
        : Math.min(hashIndex, queryIndex)

  if (suffixIndex === -1) {
    return { pathPart: destination, suffix: '' }
  }

  return {
    pathPart: destination.slice(0, suffixIndex),
    suffix: destination.slice(suffixIndex),
  }
}

function isExternalOrAbsoluteDestination(destination: string): boolean {
  return (
    destination === '' ||
    destination.startsWith('#') ||
    destination.startsWith('?') ||
    destination.startsWith('//') ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(destination) ||
    isAbsolute(destination)
  )
}

interface MarkdownDestinationRewriteContext {
  cwd: string
  resolvedPackageRoot: string
  skillDir: string
}

function findClosingBracket(line: string, start: number): number {
  let depth = 0

  for (let index = start; index < line.length; index++) {
    const char = line[index]!
    if (char === '\\') {
      index++
      continue
    }
    if (char === '[') {
      depth++
      continue
    }
    if (char === ']') {
      depth--
      if (depth === 0) return index
    }
  }

  return -1
}

function findClosingParen(line: string, start: number): number {
  for (let index = start; index < line.length; index++) {
    const char = line[index]!
    if (char === '\\') {
      index++
      continue
    }
    if (char === ')') return index
  }

  return -1
}

function readBareDestination(
  line: string,
  start: number,
): { destinationEnd: number; endParen: number } | null {
  let depth = 0

  for (let index = start; index < line.length; index++) {
    const char = line[index]!
    if (char === '\\') {
      index++
      continue
    }
    if (char === '(') {
      depth++
      continue
    }
    if (char === ')') {
      if (depth === 0) {
        return { destinationEnd: index, endParen: index }
      }
      depth--
      continue
    }
    if (/\s/.test(char) && depth === 0) {
      const endParen = findClosingParen(line, index)
      if (endParen === -1) return null
      return { destinationEnd: index, endParen }
    }
  }

  return null
}

function readMarkdownDestination(
  line: string,
  start: number,
): {
  destination: string
  destinationStart: number
  destinationEnd: number
  endParen: number
} | null {
  let cursor = start
  while (cursor < line.length && /\s/.test(line[cursor]!)) cursor++

  if (line[cursor] === '<') {
    const destinationStart = cursor + 1
    const destinationEnd = line.indexOf('>', destinationStart)
    if (destinationEnd === -1) return null
    const endParen = findClosingParen(line, destinationEnd + 1)
    if (endParen === -1) return null
    return {
      destination: line.slice(destinationStart, destinationEnd),
      destinationStart,
      destinationEnd,
      endParen,
    }
  }

  const read = readBareDestination(line, cursor)
  if (!read) return null

  return {
    destination: line.slice(cursor, read.destinationEnd),
    destinationStart: cursor,
    destinationEnd: read.destinationEnd,
    endParen: read.endParen,
  }
}

function getCodeFenceMarker(line: string): '`' | '~' | null {
  const match = line.match(/^\s*(`{3,}|~{3,})/)
  const marker = match?.[1]?.[0]
  return marker === '`' || marker === '~' ? marker : null
}

function rewriteMarkdownDestination({
  context,
  destination,
}: {
  context: MarkdownDestinationRewriteContext
  destination: string
}): string {
  if (isExternalOrAbsoluteDestination(destination)) return destination

  const { pathPart, suffix } = splitDestinationSuffix(destination)
  if (isExternalOrAbsoluteDestination(pathPart)) return destination

  const resolvedDestinationPath = resolve(context.skillDir, pathPart)
  const relativeToPackageRoot = relative(
    context.resolvedPackageRoot,
    resolvedDestinationPath,
  )
  if (
    relativeToPackageRoot.startsWith('..') ||
    isAbsolute(relativeToPackageRoot)
  ) {
    return destination
  }

  const relativeToCwd = relative(context.cwd, resolvedDestinationPath)
  const rewrittenPath =
    relativeToCwd &&
    !relativeToCwd.startsWith('..') &&
    !isAbsolute(relativeToCwd)
      ? relativeToCwd
      : resolvedDestinationPath

  return `${toPosixPath(rewrittenPath)}${suffix}`
}

function rewriteMarkdownLineDestinations({
  context,
  line,
}: {
  context: MarkdownDestinationRewriteContext
  line: string
}): string {
  if (!line.includes('[')) return line

  let output = ''
  let cursor = 0

  while (cursor < line.length) {
    const nextCodeStart = line.indexOf('`', cursor)
    const nextLinkStart = line.indexOf('[', cursor)

    if (nextLinkStart === -1) {
      output += line.slice(cursor)
      break
    }

    if (nextCodeStart !== -1 && nextCodeStart < nextLinkStart) {
      output += line.slice(cursor, nextCodeStart)
      cursor = nextCodeStart
      const codeStart = cursor
      while (cursor < line.length && line[cursor] === '`') cursor++
      const marker = line.slice(codeStart, cursor)
      const codeEnd = line.indexOf(marker, cursor)
      if (codeEnd === -1) {
        output += line.slice(codeStart)
        break
      }
      output += line.slice(codeStart, codeEnd + marker.length)
      cursor = codeEnd + marker.length
      continue
    }

    const linkStart =
      nextLinkStart > 0 && line[nextLinkStart - 1] === '!'
        ? nextLinkStart - 1
        : nextLinkStart
    output += line.slice(cursor, linkStart)

    const labelStart = nextLinkStart
    const labelEnd = findClosingBracket(line, labelStart)
    if (labelEnd === -1) {
      output += line.slice(linkStart)
      break
    }

    if (line[labelEnd + 1] !== '(') {
      output += line.slice(linkStart, nextLinkStart + 1)
      cursor = nextLinkStart + 1
      continue
    }

    const destination = readMarkdownDestination(line, labelEnd + 2)
    if (!destination) {
      output += line.slice(linkStart, nextLinkStart + 1)
      cursor = nextLinkStart + 1
      continue
    }

    const rewritten = rewriteMarkdownDestination({
      context,
      destination: destination.destination,
    })
    output +=
      line.slice(linkStart, destination.destinationStart) +
      rewritten +
      line.slice(destination.destinationEnd, destination.endParen + 1)
    cursor = destination.endParen + 1
  }

  return output
}

function rewriteLoadedSkillMarkdownDestinations({
  content,
  cwd,
  packageRoot,
  skillFilePath,
}: {
  content: string
  cwd: string
  packageRoot: string
  skillFilePath: string
}): string {
  const context: MarkdownDestinationRewriteContext = {
    cwd,
    resolvedPackageRoot: resolveFromCwd(packageRoot),
    skillDir: dirname(skillFilePath),
  }
  let inFence: '`' | '~' | null = null
  const parts = content.split(/(\r?\n)/)
  let output = ''

  for (let index = 0; index < parts.length; index += 2) {
    const line = parts[index] ?? ''
    const newline = parts[index + 1] ?? ''
    const marker = getCodeFenceMarker(line)

    if (inFence) {
      output += line + newline
      if (marker === inFence) inFence = null
      continue
    }

    if (marker) {
      inFence = marker
      output += line + newline
      continue
    }

    output +=
      rewriteMarkdownLineDestinations({
        context,
        line,
      }) + newline
  }

  return output
}

function loadResolvedIntentSkill(
  use: string,
  resolved: ResolveSkillResult,
): LoadedIntentSkill {
  const resolvedPath = resolveFromCwd(resolved.path)

  if (!isPathInsidePackageRoot(resolved.path, resolved.packageRoot)) {
    throw new IntentCoreError(
      'skill-path-outside-package',
      `Resolved skill path for "${use}" is outside package root: ${resolved.path}`,
    )
  }

  if (!existsSync(resolvedPath)) {
    throw new IntentCoreError(
      'skill-file-not-found',
      `Resolved skill file was not found: ${resolved.path}`,
    )
  }

  const content = rewriteLoadedSkillMarkdownDestinations({
    content: readFileSync(resolvedPath, 'utf8'),
    cwd: process.cwd(),
    packageRoot: resolved.packageRoot,
    skillFilePath: resolvedPath,
  })

  return {
    content,
    path: resolved.path,
    packageRoot: resolved.packageRoot,
    packageName: resolved.packageName,
    skillName: resolved.skillName,
    version: resolved.version,
    source: resolved.source,
    warnings: resolved.warnings,
    conflict: resolved.conflict,
  }
}

export function loadIntentSkill(
  use: string,
  options: IntentCoreOptions = {},
): LoadedIntentSkill {
  return withCwd(options.cwd, () => {
    let parsedUse: ReturnType<typeof parseSkillUse>
    try {
      parsedUse = parseSkillUse(use)
    } catch (err) {
      throw new IntentCoreError(
        'invalid-skill-use',
        err instanceof Error ? err.message : String(err),
      )
    }

    if (
      isPackageExcluded(
        parsedUse.packageName,
        getEffectiveExcludePatterns(options),
      )
    ) {
      throw new IntentCoreError(
        'package-excluded',
        `Cannot load skill use "${use}": package "${parsedUse.packageName}" is excluded by Intent configuration.`,
      )
    }

    const scanOptions = toScanOptions(options)
    const fastPathResolved = resolveSkillUseFastPath(parsedUse, options)
    if (fastPathResolved) {
      return loadResolvedIntentSkill(use, fastPathResolved)
    }

    const scanResult = scanForIntents(undefined, scanOptions)
    let resolved: ReturnType<typeof resolveSkillUse>
    try {
      resolved = resolveSkillUse(use, scanResult)
    } catch (err) {
      if (err instanceof ResolveSkillUseError) {
        throw new IntentCoreError(err.code, err.message)
      }
      throw err
    }

    return loadResolvedIntentSkill(use, resolved)
  })
}
