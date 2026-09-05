import { stdin, stdout } from 'node:process'
import { cancel, confirm, groupMultiselect, isCancel } from '@clack/prompts'
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

interface PermissionPromptOption {
  disabled?: boolean
  hint?: string
  label: string
  value: string
}

export interface PermissionPromptGroup {
  label: string
  options: Array<PermissionPromptOption>
}

export interface PermissionPrompts {
  confirmAllowAll: () => Promise<boolean | null>
  selectPermissions: (
    groups: Array<PermissionPromptGroup>,
  ) => Promise<Array<string> | null>
  confirmWrite: (denyAll: boolean) => Promise<boolean | null>
}

export interface ClackPermissionRuntime {
  cancel: typeof cancel
  confirm: typeof confirm
  groupMultiselect: typeof groupMultiselect
  isCancel: typeof isCancel
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

function permissionGroups(
  packages: Array<IntentPackage>,
  excludes: ReturnType<typeof compileExcludePatterns>,
): Array<PermissionPromptGroup> {
  return packages.map((pkg) => {
    const packageUnavailable = isPackageExcluded(pkg.name, excludes)
    const packageSelector = selectorForPackage(pkg)
    return {
      label: packageSelector,
      options: [
        {
          label: 'All skills',
          value: packageSelector,
          hint: 'Current and future skills; exclusions still apply',
          ...(packageUnavailable
            ? { disabled: true, hint: 'Excluded by intent.exclude' }
            : {}),
        },
        ...[...pkg.skills]
          .sort((left, right) => left.name.localeCompare(right.name))
          .map((skill) => {
            const skillUnavailable =
              packageUnavailable ||
              isSkillExcluded(pkg.name, skill.name, excludes)
            return {
              label: skill.name,
              value: `${packageSelector}#${skill.name}`,
              hint: skill.description,
              ...(skillUnavailable
                ? { disabled: true, hint: 'Excluded by intent.exclude' }
                : {}),
            }
          }),
      ],
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

function clackResult<T>(
  value: T | symbol,
  runtime: ClackPermissionRuntime,
): T | null {
  if (!runtime.isCancel(value)) return value
  runtime.cancel('Permissions: canceled.', { output: stdout })
  return null
}

export function createPermissionPrompts(
  runtime: ClackPermissionRuntime = {
    cancel,
    confirm,
    groupMultiselect,
    isCancel,
  },
): PermissionPrompts {
  return {
    confirmAllowAll: async () =>
      clackResult(
        await runtime.confirm({
          message: 'Allow all current and future skill sources?',
          initialValue: false,
          input: stdin,
          output: stdout,
        }),
        runtime,
      ),
    selectPermissions: async (groups) =>
      clackResult(
        await runtime.groupMultiselect({
          message: 'Select trusted packages and skills',
          // Clack's grouped picker does not enforce disabled options.
          options: Object.fromEntries(
            groups
              .map((group) => ({
                ...group,
                options: group.options.filter((option) => !option.disabled),
              }))
              .filter((group) => group.options.length > 0)
              .map((group) => [group.label, group.options]),
          ),
          selectableGroups: false,
          required: false,
          input: stdin,
          output: stdout,
        }),
        runtime,
      ),
    confirmWrite: async (denyAll) =>
      clackResult(
        await runtime.confirm({
          message: denyAll
            ? 'Disable all skills by writing intent.skills: []?'
            : 'Write this permission configuration?',
          initialValue: false,
          input: stdin,
          output: stdout,
        }),
        runtime,
      ),
  }
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
  console.log('Discovered skills:')
  for (const pkg of packages) {
    console.log(`  ${selectorForPackage(pkg)}@${pkg.version}`)
    for (const skill of pkg.skills) {
      const excluded =
        isPackageExcluded(pkg.name, excludes) ||
        isSkillExcluded(pkg.name, skill.name, excludes)
      console.log(
        `    ${skill.name}: ${skill.description}${excluded ? ' (Excluded by intent.exclude; unavailable)' : ''}`,
      )
    }
  }
  const availableSkillCount = packages.reduce(
    (count, pkg) =>
      count +
      pkg.skills.filter(
        (skill) =>
          !isPackageExcluded(pkg.name, excludes) &&
          !isSkillExcluded(pkg.name, skill.name, excludes),
      ).length,
    0,
  )
  if (availableSkillCount === 0) {
    const discoveredSkillCount = packages.reduce(
      (count, pkg) => count + pkg.skills.length,
      0,
    )
    console.log(
      discoveredSkillCount === 0
        ? 'No intent-enabled skills found. Install a package that ships skills, then run intent install again.'
        : 'All discovered skills are excluded by intent.exclude. Review your exclusions, then run intent install again.',
    )
    console.log('Permissions and guidance unchanged.')
    return { status: 'unavailable' }
  }
  console.log(
    'All skills includes current and future skills in that package. Exact choices permit only the named skill. Exclusions always apply.',
  )
  const allowAll = await runtime.prompts.confirmAllowAll()
  if (allowAll === null) return { status: 'canceled' }
  const selected = allowAll
    ? ['*']
    : await runtime.prompts.selectPermissions(
        permissionGroups(packages, excludes),
      )
  if (selected === null) return { status: 'canceled' }
  const skills = allowAll ? ['*'] : normalizePermissions(selected)
  const update = preparePackageSkillsUpdate(
    context.targetPackageJsonPath,
    skills,
  )

  console.log(`Permission destination: ${context.targetPackageJsonPath}`)
  console.log(`intent.skills: ${JSON.stringify(skills, null, 2)}`)
  if (skills.length === 0) {
    console.log(
      'No skills selected. This disables all skill sources, including future sources, until you edit intent.skills.',
    )
  } else {
    console.log(
      skills.length === 1 && skills[0] === '*'
        ? 'Trust change: all current and future npm and workspace skill sources will be permitted.'
        : 'Trust change: selected packages and skills can provide instructions to AI agents.',
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
