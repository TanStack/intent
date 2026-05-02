import {
  coreOptionsFromGlobalFlags,
  printDebugInfo,
  printWarnings,
  type GlobalScanFlags,
} from '../cli-support.js'
import { listIntentSkills } from '../core.js'
import type {
  IntentPackageSummary,
  IntentSkillList,
  IntentSkillSummary,
} from '../core.js'
import type { ScanOptions, ScanResult } from '../types.js'

export interface ListCommandOptions extends GlobalScanFlags {
  json?: boolean
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
    ['conflicts', result.debug.conflictCount],
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

function getPackageSkills(
  pkg: IntentPackageSummary,
  result: IntentSkillList,
): Array<IntentSkillSummary> {
  return result.skills.filter((skill) => skill.packageRoot === pkg.packageRoot)
}

export async function runListCommand(
  options: ListCommandOptions,
  _scanIntentsOrFail?: (options?: ScanOptions) => Promise<ScanResult>,
): Promise<void> {
  const result = listIntentSkills(coreOptionsFromGlobalFlags(options))
  printListDebug(result)

  if (options.json) {
    const { debug: _debug, ...jsonResult } = result
    console.log(JSON.stringify(jsonResult, null, 2))
    return
  }

  const { computeSkillNameWidth, printSkillTree, printTable } =
    await import('../display.js')

  if (result.packages.length === 0) {
    console.log('No intent-enabled packages found.')
    if (result.warnings.length > 0) {
      console.log()
      printWarnings(result.warnings)
    }
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

  const allSkills = result.packages.map((pkg) =>
    getPackageSkills(pkg, result).map((skill) => ({
      name: skill.skillName,
      description: skill.description,
      type: skill.type,
    })),
  )
  const nameWidth = computeSkillNameWidth(allSkills)
  const showTypes = result.skills.some((skill) => skill.type)

  console.log(`\nSkills:\n`)
  for (const pkg of result.packages) {
    console.log(`  ${pkg.name}`)
    printSkillTree(
      getPackageSkills(pkg, result).map((skill) => ({
        name: skill.skillName,
        description: skill.description,
        type: skill.type,
      })),
      { nameWidth, packageName: pkg.name, showTypes },
    )
    console.log()
  }

  console.log('Feedback:')
  console.log(
    '  Submit feedback on skill usage to help maintainers improve the skills.',
  )
  console.log(
    '  Load: node_modules/@tanstack/intent/meta/feedback-collection/SKILL.md',
  )
  console.log()

  printWarnings(result.warnings)
}
