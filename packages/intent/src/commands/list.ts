import {
  printWarnings,
  scanOptionsFromGlobalFlags,
  type GlobalScanFlags,
} from '../cli-support.js'
import type { ScanOptions, ScanResult } from '../types.js'

export interface ListCommandOptions extends GlobalScanFlags {
  json?: boolean
}

function formatScanCoverage(result: ScanResult): string {
  const coverage: Array<string> = []

  if (result.nodeModules.local.scanned) coverage.push('project node_modules')
  if (result.nodeModules.global.scanned) coverage.push('global node_modules')

  return coverage.join(', ')
}

function printVersionConflicts(result: ScanResult): void {
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

export async function runListCommand(
  options: ListCommandOptions,
  scanIntentsOrFail: (options?: ScanOptions) => Promise<ScanResult>,
): Promise<void> {
  const result = await scanIntentsOrFail(scanOptionsFromGlobalFlags(options))

  if (options.json) {
    console.log(JSON.stringify(result, null, 2))
    return
  }

  const { computeSkillNameWidth, printSkillTree, printTable } =
    await import('../display.js')

  const scanCoverage = formatScanCoverage(result)

  if (result.packages.length === 0) {
    console.log('No intent-enabled packages found.')
    if (scanCoverage) console.log(`Scanned: ${scanCoverage}`)
    if (result.warnings.length > 0) {
      console.log()
      printWarnings(result.warnings)
    }
    return
  }

  const totalSkills = result.packages.reduce(
    (sum, pkg) => sum + pkg.skills.length,
    0,
  )
  console.log(
    `\n${result.packages.length} intent-enabled packages, ${totalSkills} skills (${result.packageManager})\n`,
  )
  if (scanCoverage) {
    console.log(
      `Scanned: ${scanCoverage}${result.nodeModules.global.scanned ? ' (local packages take precedence)' : ''}\n`,
    )
  }

  const rows = result.packages.map((pkg) => [
    pkg.name,
    pkg.source,
    pkg.version,
    String(pkg.skills.length),
    pkg.intent.requires?.join(', ') || '–',
  ])
  printTable(['PACKAGE', 'SOURCE', 'VERSION', 'SKILLS', 'REQUIRES'], rows)

  printVersionConflicts(result)

  const allSkills = result.packages.map((pkg) => pkg.skills)
  const nameWidth = computeSkillNameWidth(allSkills)
  const showTypes = result.packages.some((pkg) =>
    pkg.skills.some((skill) => skill.type),
  )

  console.log(`\nSkills:\n`)
  for (const pkg of result.packages) {
    console.log(`  ${pkg.name}`)
    printSkillTree(pkg.skills, { nameWidth, packageName: pkg.name, showTypes })
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
