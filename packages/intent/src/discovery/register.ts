import { existsSync } from 'node:fs'
import { join, sep } from 'node:path'
import { rewriteSkillLoadPaths } from '../skill-paths.js'
import { listNodeModulesPackageDirs } from '../utils.js'
import type {
  IntentConfig,
  IntentPackage,
  NodeModulesScanTarget,
  SkillEntry,
} from '../types.js'

type PackageJson = Record<string, unknown>

function isLocalToProject(dirPath: string, projectRoot: string): boolean {
  return (
    dirPath.startsWith(projectRoot + sep) ||
    dirPath.startsWith(projectRoot + '/')
  )
}

export interface CreatePackageRegistrarOptions {
  comparePackageVersions: (a: string, b: string) => number
  deriveIntentConfig: (pkgJson: PackageJson) => IntentConfig | null
  discoverSkills: (skillsDir: string, baseName: string) => Array<SkillEntry>
  getPackageDepth: (packageRoot: string, projectRoot: string) => number
  packageIndexes: Map<string, number>
  packages: Array<IntentPackage>
  projectRoot: string
  readPkgJson: (dirPath: string) => PackageJson | null
  rememberVariant: (pkg: IntentPackage) => void
  validateIntentField: (pkgName: string, intent: unknown) => IntentConfig | null
  warnings: Array<string>
}

export function createPackageRegistrar(opts: CreatePackageRegistrarOptions) {
  function scanTarget(
    target: NodeModulesScanTarget,
    source: IntentPackage['source'] = 'local',
  ): void {
    if (!target.path || !target.exists || target.scanned) return
    target.scanned = true

    for (const dirPath of listNodeModulesPackageDirs(target.path)) {
      tryRegister(dirPath, 'unknown', source)
    }
  }

  function tryRegister(
    dirPath: string,
    fallbackName: string,
    source: IntentPackage['source'] = 'local',
  ): boolean {
    const skillsDir = join(dirPath, 'skills')
    if (!existsSync(skillsDir)) return false

    const pkgJson = opts.readPkgJson(dirPath)
    if (!pkgJson) {
      opts.warnings.push(`Could not read package.json for ${dirPath}`)
      return false
    }

    const name = typeof pkgJson.name === 'string' ? pkgJson.name : fallbackName
    const version =
      typeof pkgJson.version === 'string' ? pkgJson.version : '0.0.0'
    const intent =
      opts.validateIntentField(name, pkgJson.intent) ??
      opts.deriveIntentConfig(pkgJson)
    if (!intent) {
      opts.warnings.push(
        `${name} has a skills/ directory but could not determine repo/docs from package.json (add a "repository" field or explicit "intent" config)`,
      )
      return false
    }

    const skills = opts.discoverSkills(skillsDir, name)

    if (isLocalToProject(dirPath, opts.projectRoot)) {
      rewriteSkillLoadPaths({
        packageName: name,
        packageRoot: dirPath,
        projectRoot: opts.projectRoot,
        skills,
      })
    }

    const candidate: IntentPackage = {
      name,
      version,
      intent,
      skills,
      packageRoot: dirPath,
      source,
    }
    const existingIndex = opts.packageIndexes.get(name)
    if (existingIndex === undefined) {
      opts.rememberVariant(candidate)
      opts.packageIndexes.set(name, opts.packages.push(candidate) - 1)
      return true
    }

    const existing = opts.packages[existingIndex]!
    if (existing.packageRoot === candidate.packageRoot) {
      return false
    }

    opts.rememberVariant(existing)
    opts.rememberVariant(candidate)

    const existingDepth = opts.getPackageDepth(
      existing.packageRoot,
      opts.projectRoot,
    )
    const candidateDepth = opts.getPackageDepth(
      candidate.packageRoot,
      opts.projectRoot,
    )
    const shouldReplace =
      candidateDepth < existingDepth ||
      (candidateDepth === existingDepth &&
        opts.comparePackageVersions(candidate.version, existing.version) > 0)

    if (shouldReplace) {
      opts.packages[existingIndex] = candidate
    }

    return true
  }

  return { scanTarget, tryRegister }
}
