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
  confirmWrite: () => Promise<boolean | null>
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
          options: Object.fromEntries(
            groups.map((group) => [group.label, group.options]),
          ),
          selectableGroups: false,
          required: false,
          input: stdin,
          output: stdout,
        }),
        runtime,
      ),
    confirmWrite: async () =>
      clackResult(
        await runtime.confirm({
          message: 'Write this permission configuration?',
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
  console.log(
    skills.length === 1 && skills[0] === '*'
      ? 'Trust change: all current and future npm and workspace skill sources will be permitted.'
      : 'Trust change: selected packages and skills can provide instructions to AI agents.',
  )

  if (dryRun) {
    return {
      packageJsonPath: context.targetPackageJsonPath,
      status: 'unchanged',
    }
  }

  const confirmation = await runtime.prompts.confirmWrite()
  if (confirmation !== true) {
    console.log('Permissions: canceled.')
    return { status: 'canceled' }
  }

  return {
    packageJsonPath: context.targetPackageJsonPath,
    status: writePreparedPackageSkillsUpdate(update),
  }
}
