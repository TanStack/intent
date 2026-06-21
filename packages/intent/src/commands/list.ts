import {
  coreOptionsFromGlobalFlags,
  noticeOptionsFromGlobalFlags,
  printDebugInfo,
  printNotices,
  printWarnings,
} from './support.js'
import { detectIntentAudience } from '../shared/environment.js'
import { formatIntentCommand } from '../shared/command-runner.js'
import { listIntentSkills } from '../core/index.js'
import type { GlobalScanFlags } from './support.js'
import type {
  IntentPackageSummary,
  IntentSkillList,
  IntentSkillSummary,
} from '../core/index.js'
import type { ScanResult } from '../shared/types.js'

export interface ListCommandOptions extends GlobalScanFlags {
  json?: boolean
  showHidden?: boolean
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

function printVersionConflicts(result: IntentSkillList): void {
  if (result.conflicts.length === 0) return

  console.log('\nVersion conflicts:\n')
  for (const conflict of result.conflicts) {
    console.log(`  ${conflict.packageName} -> using ${conflict.chosen.version}`)
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

function formatLoadCommand(
  skill: IntentSkillSummary,
  packageManager: ScanResult['packageManager'],
  scopeFlag: string,
): string {
  return formatIntentCommand(packageManager, `load ${skill.use}${scopeFlag}`)
}

function printHiddenSources(result: IntentSkillList, audience: string): void {
  if (audience === 'agent') {
    console.log(
      'Hidden skill sources are not revealed in agent sessions. Run this command outside the agent session to review candidates.',
    )
    return
  }

  if (result.hiddenSources.length === 0) return

  console.log('\nHidden skill sources:\n')
  for (const source of result.hiddenSources) {
    console.log(
      `  ${source.name} (${source.skillCount} ${source.skillCount === 1 ? 'skill' : 'skills'})`,
    )
  }
}

export async function runListCommand(
  options: ListCommandOptions,
): Promise<void> {
  const audience = detectIntentAudience()
  const result = listIntentSkills({
    ...coreOptionsFromGlobalFlags(options),
    audience,
  })
  const noticeOptions = noticeOptionsFromGlobalFlags(options)
  printListDebug(result)

  if (options.json) {
    const {
      debug: _debug,
      packageManager: _packageManager,
      ...jsonResult
    } = result
    console.log(JSON.stringify(jsonResult, null, 2))
    return
  }

  const { computeSkillNameWidth, printSkillTree, printTable } =
    await import('../shared/display.js')

  if (result.packages.length === 0) {
    console.log('No intent-enabled packages found.')
    if (options.showHidden && result.hiddenSourceCount > 0) {
      printHiddenSources(result, audience)
    }
    if (result.warnings.length > 0) {
      console.log()
      printWarnings(result.warnings)
    }
    printNotices(result.notices, noticeOptions)
    return
  }

  console.log(
    `\n${result.packages.length} intent-enabled packages, ${result.skills.length} skills\n`,
  )

  const rows = result.packages.map((pkg) => [
    pkg.name,
    pkg.source,
    pkg.version,
    String(pkg.skillCount),
  ])
  printTable(['PACKAGE', 'SOURCE', 'VERSION', 'SKILLS'], rows)

  printVersionConflicts(result)

  if (options.showHidden) {
    printHiddenSources(result, audience)
  }

  const skillsByPackageRoot = groupSkillsByPackageRoot(result.skills)
  const allSkills = result.packages.map((pkg) =>
    getPackageSkills(pkg, skillsByPackageRoot).map((skill) => ({
      name: skill.skillName,
      description: skill.description,
      type: skill.type,
    })),
  )
  const nameWidth = computeSkillNameWidth(allSkills)
  const showTypes = result.skills.some((skill) => skill.type)
  const scopeFlag = options.globalOnly
    ? ' --global-only'
    : options.global
      ? ' --global'
      : ''

  console.log(`\nSkills:\n`)
  for (const pkg of result.packages) {
    console.log(`  ${pkg.name}`)
    printSkillTree(
      getPackageSkills(pkg, skillsByPackageRoot).map((skill) => ({
        name: skill.skillName,
        description: skill.description,
        loadCommand: formatLoadCommand(skill, result.packageManager, scopeFlag),
        type: skill.type,
      })),
      { nameWidth, packageName: pkg.name, showTypes },
    )
    console.log()
  }

  printWarnings(result.warnings)
  printNotices(result.notices, noticeOptions)
}
