import {
  compileExcludePatterns,
  getEffectiveExcludePatterns,
  isPackageExcluded,
  isSkillExcluded,
} from '../../core/excludes.js'
import { resolveProjectContext } from '../../core/project-context.js'
// First-run permission setup must show unpoliced candidates for explicit review.
// eslint-disable-next-line no-restricted-imports
import { scanForIntents } from '../../discovery/scanner.js'
import {
  ALLOW_ALL_NOTICE,
  printNotices,
  printWarnings,
} from '../../shared/cli-output.js'
import {
  preparePackageSkillsUpdate,
  writePreparedPackageSkillsUpdate,
} from './package-json.js'
import type { IntentPackage, ScanResult } from '../../shared/types.js'

export interface PermissionPackage {
  id: string
  version: string
  skills: Array<{
    id: string
    name: string
    description: string
    excluded: boolean
  }>
}

export interface PermissionPrompts {
  selectPermissions: (
    packages: Array<PermissionPackage>,
    packageJsonPath: string,
  ) => Promise<Array<string> | null>
  confirmWrite: (denyAll: boolean) => Promise<boolean | null>
}

export interface PermissionSetupRuntime {
  scan?: (root: string) => ScanResult
  prompts: PermissionPrompts
}

export type PermissionSetupResult =
  | { status: 'canceled' }
  | { status: 'unavailable' }
  | { packageJsonPath: string; status: 'unchanged' | 'updated' }

function selectorForPackage(pkg: IntentPackage): string {
  return pkg.kind === 'workspace' ? `workspace:${pkg.name}` : pkg.name
}

function permissionPackages(
  packages: Array<IntentPackage>,
  excludes: ReturnType<typeof compileExcludePatterns>,
): Array<PermissionPackage> {
  return packages.map((pkg) => {
    const id = selectorForPackage(pkg)
    return {
      id,
      version: pkg.version,
      skills: [...pkg.skills]
        .sort((left, right) => left.name.localeCompare(right.name))
        .map((skill) => ({
          id: `${id}#${skill.name}`,
          name: skill.name,
          description: skill.description,
          excluded:
            isPackageExcluded(pkg.name, excludes) ||
            isSkillExcluded(pkg.name, skill.name, excludes),
        })),
    }
  })
}

function normalizePermissions(selected: Array<string>): Array<string> {
  const values = new Set(selected)
  for (const value of selected) {
    if (!value.includes('#')) continue
    const packageSelector = value.slice(0, value.indexOf('#'))
    if (values.has(packageSelector)) values.delete(value)
  }
  return [...values].sort((left, right) => left.localeCompare(right))
}

export async function setupInitialPermissions({
  dryRun = false,
  root,
  runtime,
}: {
  dryRun?: boolean
  root: string
  runtime: PermissionSetupRuntime
}): Promise<PermissionSetupResult> {
  const context = resolveProjectContext({ cwd: root })
  if (!context.targetPackageJsonPath) {
    throw new Error(
      'Cannot configure permissions: no owning package.json was found.',
    )
  }

  const scan = (
    runtime.scan ?? ((cwd) => scanForIntents(cwd, { scope: 'local' }))
  )(root)
  const packages = [...scan.packages].sort((left, right) =>
    selectorForPackage(left).localeCompare(selectorForPackage(right)),
  )
  const excludes = compileExcludePatterns(
    getEffectiveExcludePatterns({}, context),
  )
  printWarnings(scan.warnings)
  const candidates = permissionPackages(packages, excludes)
  const discoveredSkills = candidates.flatMap((pkg) => pkg.skills)
  const availableSkillCount = discoveredSkills.filter(
    (skill) => !skill.excluded,
  ).length
  console.log(
    `Found ${discoveredSkills.length} skill${discoveredSkills.length === 1 ? '' : 's'} in ${packages.length} package${packages.length === 1 ? '' : 's'}.`,
  )
  if (availableSkillCount === 0) {
    console.log(
      discoveredSkills.length === 0
        ? 'No intent-enabled skills found. Install a package that ships skills, then run intent install again.'
        : 'All discovered skills are excluded by intent.exclude. Review your exclusions, then run intent install again.',
    )
    console.log('Permissions and guidance unchanged.')
    return { status: 'unavailable' }
  }
  const excludedCount = discoveredSkills.length - availableSkillCount
  if (excludedCount > 0) {
    console.log(
      `${excludedCount} excluded skills are unavailable. Inspect a package to view them.`,
    )
  }
  const selected = await runtime.prompts.selectPermissions(
    candidates,
    context.targetPackageJsonPath,
  )
  if (selected === null) return { status: 'canceled' }
  const skills = normalizePermissions(selected)
  const update = preparePackageSkillsUpdate(
    context.targetPackageJsonPath,
    skills,
  )

  console.log(`Permission destination: ${context.targetPackageJsonPath}`)
  if (skills.length === 0) {
    console.log(
      'No skills selected. This disables all skill sources, including future sources, until you edit intent.skills.',
    )
  } else {
    console.log(
      skills.length === 1 && skills[0] === '*'
        ? 'Trust change: all current and future npm and workspace skill sources will be permitted.'
        : `Trust change: package-wide permissions: ${skills.filter((skill) => !skill.includes('#')).length}; individual skills: ${skills.filter((skill) => skill.includes('#')).length}. These sources can provide instructions to AI agents.`,
    )
  }
  if (skills.length === 1 && skills[0] === '*') {
    printNotices([ALLOW_ALL_NOTICE])
  }

  if (dryRun) {
    return {
      packageJsonPath: context.targetPackageJsonPath,
      status: 'unchanged',
    }
  }

  const confirmation = await runtime.prompts.confirmWrite(skills.length === 0)
  if (confirmation !== true) {
    console.log('Permissions: canceled.')
    return { status: 'canceled' }
  }

  return {
    packageJsonPath: context.targetPackageJsonPath,
    status: writePreparedPackageSkillsUpdate(update),
  }
}
