import { detectIntentAudience } from '../shared/environment.js'
import { formatIntentCommand } from '../shared/command-runner.js'
import { listIntentSkills } from '../core/index.js'
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
): string {
  return formatIntentCommand(packageManager, `load ${skillUse}${scopeFlag}`)
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
  options: ListCommandOptions,
): Promise<void> {
  const audience = detectIntentAudience()
  const explain = audience === 'human' && options.why === true && !options.json
  const result = listIntentSkills({
    ...coreOptionsFromGlobalFlags(options),
    audience,
    why: explain,
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

  if (result.packages.length === 0 && result.excludedSkills?.length === 0) {
    console.log('No intent-enabled packages found.')
    if (options.showHidden && result.hiddenSourceCount > 0) {
      printHiddenSources(result, audience, explain)
    }
    if (result.warnings.length > 0) {
      console.log()
      printWarnings(result.warnings)
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

  printVersionConflicts(result)

  if (options.showHidden) {
    printHiddenSources(result, audience, explain)
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
  const scopeFlag = options.globalOnly
    ? ' --global-only'
    : options.global
      ? ' --global'
      : ''

  if (audience === 'agent') {
    console.log(
      `Load a skill with \`${formatLoadCommand('<id>', result.packageManager, scopeFlag)}\`.`,
    )
  }

  console.log(`\nSkills:\n`)
  for (const pkg of packagesWithSkills) {
    console.log(`  ${pkg.name}`)
    printSkillTree(
      getPackageSkills(pkg, skillsByPackageRoot).map((skill) => ({
        name: skill.skillName,
        description: 'excluded' in skill ? '(excluded)' : skill.description,
        loadCommand:
          audience === 'human' && !('excluded' in skill)
            ? formatLoadCommand(skill.use, result.packageManager, scopeFlag)
            : undefined,
        type: skill.type,
        why: skill.why,
      })),
      { nameWidth, packageName: pkg.name, showTypes },
    )
    console.log()
  }

  printWarnings(result.warnings)
  if (audience === 'human') {
    printNotices(result.notices, noticeOptions)
  }
}
