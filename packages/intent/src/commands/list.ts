import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { formatIntentCommand } from '../shared/command-runner.js'
import { containsLocalPath } from '../shared/local-path.js'
import { warningMentionsPackage } from '../core/excludes.js'
import { listIntentSkills } from '../core/index.js'
import { resolveProjectContext } from '../core/project-context.js'
import { ALLOW_ALL_NOTICE } from '../shared/cli-output.js'
import { hasIntentDevDependency } from './install/config.js'
import {
  coreOptionsFromGlobalFlags,
  noticeOptionsFromGlobalFlags,
  printDebugInfo,
  printNotices,
  printWarnings,
} from './support.js'
import type { GlobalScanFlags } from './support.js'
import type {
  IntentExcludedSkillSummary,
  IntentPackageSummary,
  IntentSkillList,
  IntentSkillSummary,
} from '../core/index.js'
import type { ScanResult } from '../shared/types.js'

export interface ListCommandOptions extends GlobalScanFlags {
  json?: boolean
  showHidden?: boolean
  verbose?: boolean
  why?: boolean
}

function printListDebug(result: IntentSkillList): void {
  if (!result.debug) return

  printDebugInfo('intent list', [
    ['cwd', result.debug.cwd],
    ['scope', result.debug.scope],
    ['excludes', result.debug.excludes],
    ['packages', result.debug.packageCount],
    ['skills', result.debug.skillCount],
    ['warnings', result.debug.warningCount],
    ['notices', result.debug.noticeCount],
    ['conflicts', result.debug.conflictCount],
    ['packageJsonReadCount', result.debug.scan.packageJsonReadCount],
    ['packageJsonCacheHits', result.debug.scan.packageJsonCacheHits],
  ])
}

function printVersionConflicts(result: IntentSkillList, debug: boolean): void {
  if (result.conflicts.length === 0) return

  console.log('\nVersion conflicts:\n')
  for (const conflict of result.conflicts) {
    console.log(
      `  ${conflict.packageName}: using ${conflict.chosen.version} (${conflict.variants.length} installed)`,
    )
    if (!debug) continue

    console.log(`    chosen: ${conflict.chosen.packageRoot}`)

    for (const variant of conflict.variants) {
      if (variant.packageRoot === conflict.chosen.packageRoot) continue
      console.log(
        `    also found: ${variant.version} at ${variant.packageRoot}`,
      )
    }

    console.log()
  }
}

function visibleWarnings(
  result: IntentSkillList,
  audience: string,
): Array<string> {
  const conflictNames = result.conflicts.map((conflict) => conflict.packageName)
  return result.warnings.filter(
    (warning) =>
      !conflictNames.some((name) => warningMentionsPackage(warning, name)) &&
      (audience !== 'agent' || !containsLocalPath(warning)),
  )
}

function filterResultByPackage(
  result: IntentSkillList,
  packageName: string,
): IntentSkillList {
  const packages = result.packages.filter((pkg) => pkg.name === packageName)
  const skills = result.skills.filter(
    (skill) => skill.packageName === packageName,
  )
  const excludedSkills = result.excludedSkills?.filter(
    (skill) => skill.packageName === packageName,
  )
  const hiddenSources = result.hiddenSources.filter(
    (source) => source.name === packageName,
  )
  const conflicts = result.conflicts.filter(
    (conflict) => conflict.packageName === packageName,
  )
  const warnings = result.warnings.filter((warning) =>
    warningMentionsPackage(warning, packageName),
  )
  const notices = result.notices.filter(
    (notice) =>
      notice === ALLOW_ALL_NOTICE ||
      warningMentionsPackage(notice, packageName),
  )

  return {
    ...result,
    packages,
    skills,
    excludedSkills,
    hiddenSourceCount: hiddenSources.length,
    hiddenSources,
    conflicts,
    warnings,
    notices,
    ...(result.debug
      ? {
          debug: {
            ...result.debug,
            packageCount: packages.length,
            skillCount: skills.length,
            warningCount: warnings.length,
            noticeCount: notices.length,
            conflictCount: conflicts.length,
          },
        }
      : {}),
  }
}

function usesInstalledIntent(): boolean {
  const context = resolveProjectContext({ cwd: process.cwd() })
  const root = context.workspaceRoot ?? context.packageRoot ?? context.cwd
  const packageJsonPath = join(root, 'package.json')
  return (
    existsSync(packageJsonPath) &&
    hasIntentDevDependency(readFileSync(packageJsonPath, 'utf8'))
  )
}

function redactPackageRoot<T extends { packageRoot: string }>(entry: T): T {
  return { ...entry, packageRoot: '' }
}

function groupSkillsByPackageRoot(
  skills: Array<IntentSkillSummary>,
): Map<string, Array<IntentSkillSummary>> {
  const grouped = new Map<string, Array<IntentSkillSummary>>()

  for (const skill of skills) {
    const packageSkills = grouped.get(skill.packageRoot)
    if (packageSkills) {
      packageSkills.push(skill)
    } else {
      grouped.set(skill.packageRoot, [skill])
    }
  }

  return grouped
}

function getPackageSkills(
  pkg: IntentPackageSummary,
  skillsByPackageRoot: Map<string, Array<IntentSkillSummary>>,
): Array<IntentSkillSummary> {
  return skillsByPackageRoot.get(pkg.packageRoot) ?? []
}

function getExcludedPackageSummary(
  skill: IntentExcludedSkillSummary,
): IntentPackageSummary {
  return {
    name: skill.packageName,
    version: skill.packageVersion,
    source: skill.packageSource,
    packageRoot: skill.packageRoot,
    skillCount: 0,
  }
}

function formatLoadCommand(
  skillUse: string,
  packageManager: ScanResult['packageManager'],
  scopeFlag: string,
  local: boolean,
): string {
  return formatIntentCommand(packageManager, `load ${skillUse}${scopeFlag}`, {
    local,
  })
}

function printHiddenSources(
  result: IntentSkillList,
  audience: string,
  why: boolean,
): void {
  if (audience === 'agent') {
    console.log(
      'Hidden skill sources are not revealed in agent sessions. Run this command outside the agent session to review candidates.',
    )
    return
  }

  if (result.hiddenSources.length === 0) return

  console.log('\nHidden skill sources:\n')
  for (const source of result.hiddenSources) {
    const count = `${source.skillCount} ${source.skillCount === 1 ? 'skill' : 'skills'}`
    console.log(
      source.hiddenSkills
        ? `  ${source.name} (${count} not listed: ${source.hiddenSkills.join(', ')})`
        : `  ${source.name} (${count})`,
    )
    if (why) {
      console.log('    Hidden because not listed in intent.skills')
    }
  }
}

export async function runListCommand(
  packageName: string | undefined,
  options: ListCommandOptions,
): Promise<void> {
  const audience =
    process.env.INTENT_AUDIENCE?.trim().toLowerCase() === 'agent'
      ? 'agent'
      : 'human'
  const explain = audience === 'human' && options.why === true
  const listed = listIntentSkills({
    ...coreOptionsFromGlobalFlags(options),
    audience,
    why: explain,
  })
  const result = packageName
    ? filterResultByPackage(listed, packageName)
    : listed
  const noticeOptions = noticeOptionsFromGlobalFlags(options)
  const warnings = visibleWarnings(result, audience)
  const localIntent = usesInstalledIntent()
  printListDebug(result)

  if (options.json) {
    const {
      debug: _debug,
      packageManager: _packageManager,
      ...jsonResult
    } = result
    const outputResult =
      audience === 'agent'
        ? {
            ...jsonResult,
            skills: jsonResult.skills.map(redactPackageRoot),
            excludedSkills: jsonResult.excludedSkills?.map(redactPackageRoot),
            packages: jsonResult.packages.map(redactPackageRoot),
            warnings,
            conflicts: [],
          }
        : jsonResult
    console.log(JSON.stringify(outputResult, null, 2))
    return
  }

  const { computeSkillNameWidth, printSkillTree, printTable } =
    await import('../shared/display.js')

  if (
    result.packages.length === 0 &&
    (result.excludedSkills?.length ?? 0) === 0
  ) {
    console.log(
      packageName
        ? `No intent-enabled package found: ${packageName}.`
        : 'No intent-enabled packages found.',
    )
    if (options.showHidden && result.hiddenSourceCount > 0) {
      printHiddenSources(result, audience, explain)
    }
    if (warnings.length > 0) {
      console.log()
      printWarnings(warnings)
    }
    if (audience === 'human') {
      printNotices(result.notices, noticeOptions)
    }
    return
  }

  console.log(
    `\n${result.packages.length} intent-enabled packages, ${result.skills.length} skills\n`,
  )

  if (audience === 'human') {
    const rows = result.packages.map((pkg) => [
      pkg.name,
      pkg.source,
      pkg.version,
      String(pkg.skillCount),
    ])
    printTable(['PACKAGE', 'SOURCE', 'VERSION', 'SKILLS'], rows)
  }

  if (audience === 'human') {
    printVersionConflicts(result, options.debug === true)
  }

  if (options.showHidden) {
    printHiddenSources(result, audience, explain)
  }

  const scopeFlag = options.globalOnly
    ? ' --global-only'
    : options.global
      ? ' --global'
      : ''

  if (audience === 'agent') {
    if (packageName) {
      console.log(`\nSkills in ${packageName}:\n`)
      for (const skill of result.skills) console.log(`  ${skill.use}`)
      console.log(
        `\nLoad a skill with \`${formatLoadCommand('<id>', result.packageManager, scopeFlag, localIntent)}\`.`,
      )
    } else {
      console.log('\nPackages:\n')
      for (const pkg of result.packages) console.log(`  ${pkg.name}`)
      console.log(
        `\nFor local task matching, run \`${formatIntentCommand(result.packageManager, 'catalog', { local: localIntent })}\`.`,
      )
    }
    printWarnings(warnings)
    return
  }

  if (!packageName && !options.verbose && !options.why) {
    printWarnings(warnings)
    printNotices(result.notices, noticeOptions)
    return
  }

  const displaySkills = [...result.skills, ...(result.excludedSkills ?? [])]
  const skillsByPackageRoot = groupSkillsByPackageRoot(displaySkills)
  const displayPackages = [...result.packages]
  for (const skill of result.excludedSkills ?? []) {
    if (!displayPackages.some((pkg) => pkg.packageRoot === skill.packageRoot)) {
      displayPackages.push(getExcludedPackageSummary(skill))
    }
  }
  const packagesWithSkills = displayPackages.filter(
    (pkg) => getPackageSkills(pkg, skillsByPackageRoot).length > 0,
  )
  const allSkills = packagesWithSkills.map((pkg) =>
    getPackageSkills(pkg, skillsByPackageRoot).map((skill) => ({
      name: skill.skillName,
      description: 'excluded' in skill ? '(excluded)' : skill.description,
      type: skill.type,
    })),
  )
  const nameWidth = computeSkillNameWidth(allSkills)
  const showTypes = result.skills.some((skill) => skill.type)
  console.log(`\nSkills:\n`)
  for (const pkg of packagesWithSkills) {
    console.log(`  ${pkg.name}`)
    printSkillTree(
      getPackageSkills(pkg, skillsByPackageRoot).map((skill) => ({
        name: skill.skillName,
        description: 'excluded' in skill ? '(excluded)' : skill.description,
        loadCommand:
          audience === 'human' && !('excluded' in skill)
            ? formatLoadCommand(
                skill.use,
                result.packageManager,
                scopeFlag,
                localIntent,
              )
            : undefined,
        type: skill.type,
        why: skill.why,
      })),
      { nameWidth, packageName: pkg.name, showTypes },
    )
    console.log()
  }

  printWarnings(warnings)
  if (audience === 'human') {
    printNotices(result.notices, noticeOptions)
  }
}
