import {
  compileExcludePatterns,
  getEffectiveExcludePatterns,
  isPackageExcluded,
  isSkillExcluded,
} from '../../core/excludes.js'
import { parseSkillSources } from '../../core/skill-sources.js'
import { isSourcePermitted } from '../../core/source-policy.js'
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

export interface PermissionSelection {
  skills: Array<string>
  exclude: Array<string>
}

export interface PermissionPrompts {
  selectPermissions: (
    packages: Array<PermissionPackage>,
  ) => Promise<Array<string> | null>
  reviewPermissions: (
    packages: Array<PermissionPackage>,
    selection: PermissionSelection,
  ) => Promise<PermissionSelection | null>
  confirmWrite: (denyAll: boolean) => Promise<boolean | 'review' | null>
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

export function selectedPermissionSkills(
  packages: Array<PermissionPackage>,
  selection: PermissionSelection,
): Array<PermissionPackage['skills'][number]> {
  const config = parseSkillSources(selection.skills)
  const excludes = compileExcludePatterns(selection.exclude)
  return packages.flatMap((pkg) => {
    const kind = pkg.id.startsWith('workspace:') ? 'workspace' : 'npm'
    const name =
      kind === 'workspace' ? pkg.id.slice('workspace:'.length) : pkg.id
    return pkg.skills.filter(
      (skill) =>
        !skill.excluded &&
        isSourcePermitted(config, name, kind, skill.name) &&
        !isSkillExcluded(name, skill.name, excludes),
    )
  })
}

function normalizePermissions(selected: Array<string>): Array<string> {
  const values = [...new Set(selected)]
  if (values.includes('*')) return ['*']
  return values
    .filter((value) => {
      const config = parseSkillSources([value])
      if (config.mode !== 'explicit') return true
      const source = config.sources[0]!
      if (source.kind === 'git' || 'pattern' in source) return true
      const others = parseSkillSources(
        values.filter(
          (other) =>
            other !== value &&
            (source.skill !== undefined || !other.includes('#')),
        ),
      )
      return !isSourcePermitted(others, source.id, source.kind, source.skill)
    })
    .sort((left, right) => left.localeCompare(right))
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
      `${excludedCount} skill${excludedCount === 1 ? '' : 's'} excluded by intent.exclude.`,
    )
  }
  console.log('Skills can change when dependencies update.')
  const selected = await runtime.prompts.selectPermissions(candidates)
  if (selected === null) return { status: 'canceled' }
  let selection: PermissionSelection = { skills: selected, exclude: [] }
  for (;;) {
    const skills = normalizePermissions(selection.skills)
    const update = preparePackageSkillsUpdate(
      context.targetPackageJsonPath,
      skills,
      selection.exclude,
    )
    const enabled = selectedPermissionSkills(candidates, selection)
    const packageCount = new Set(enabled.map((skill) => skill.id.split('#')[0]))
      .size

    console.log(`Permission destination: ${context.targetPackageJsonPath}`)
    if (skills.length === 0) {
      console.log(
        'No skills selected. This disables all skill sources, including future sources, until you edit intent.skills.',
      )
    } else {
      console.log(
        `Selected: ${enabled.length} skill${enabled.length === 1 ? '' : 's'} from ${packageCount} package${packageCount === 1 ? '' : 's'} currently available.`,
      )
      if (skills.some((skill) => !skill.includes('#'))) {
        console.log(
          'Package and scope rules also enable future skills in matching sources. Exclusions still apply.',
        )
      }
    }
    for (const [label, values] of [
      ['intent.skills', skills],
      ['Add to intent.exclude', selection.exclude],
    ] as const) {
      if (values.length === 0) continue
      console.log(
        `${label}: ${JSON.stringify(values.slice(0, 6))}${values.length > 6 ? ` (+${values.length - 6} more)` : ''}`,
      )
    }
    if (skills.length === 1 && skills[0] === '*')
      printNotices([ALLOW_ALL_NOTICE])

    if (dryRun) {
      return {
        packageJsonPath: context.targetPackageJsonPath,
        status: 'unchanged',
      }
    }
    const confirmation = await runtime.prompts.confirmWrite(skills.length === 0)
    if (confirmation === 'review') {
      const reviewed = await runtime.prompts.reviewPermissions(
        candidates,
        selection,
      )
      if (reviewed === null) return { status: 'canceled' }
      selection = reviewed
      continue
    }
    if (confirmation !== true) {
      console.log('Permissions: canceled.')
      return { status: 'canceled' }
    }
    return {
      packageJsonPath: context.targetPackageJsonPath,
      status: writePreparedPackageSkillsUpdate(update),
    }
  }
}
