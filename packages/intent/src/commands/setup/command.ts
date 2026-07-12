import { relative } from 'node:path'
import { fail } from '../../shared/cli-error.js'
import type { EditPackageJsonPlan, MonorepoResult } from '../../setup/index.js'

export interface SetupCommandOptions {
  check?: boolean
  dryRun?: boolean
  write?: boolean
}

function flattenPlans(
  result:
    | Array<MonorepoResult<EditPackageJsonPlan | null>>
    | EditPackageJsonPlan
    | null,
): Array<EditPackageJsonPlan> {
  return Array.isArray(result)
    ? result.flatMap(({ result: plan }) => (plan ? [plan] : []))
    : result
      ? [result]
      : []
}

function printPlan(root: string, plan: EditPackageJsonPlan): void {
  console.log(relative(root, plan.packageJsonPath) || 'package.json')
  for (const change of plan.added) console.log(`  + ${change}`)
  if (plan.added.length === 0) console.log('  Package setup is already current')
}

export async function runSetupCommand(
  root: string,
  options: SetupCommandOptions,
): Promise<void> {
  const modes = [options.dryRun, options.write, options.check].filter(Boolean)
  if (modes.length > 1) {
    fail(
      'Use exactly one of --dry-run, --write, or --check with `intent setup`.',
    )
  }
  if (modes.length === 0) {
    console.log(
      'Preview package setup with `intent setup --dry-run`, then apply it with `intent setup --write`.',
    )
    return
  }

  const { planEditPackageJsonAll, writeEditPackageJsonPlan } =
    await import('../../setup/index.js')
  const plans = flattenPlans(planEditPackageJsonAll(root))
  if (plans.length === 0) fail('No package.json was found for Intent setup.')

  const pending = plans.filter((plan) => plan.added.length > 0)
  if (options.check) {
    if (pending.length === 0) {
      console.log('✅ Package setup is current')
      return
    }
    const details = pending.flatMap((plan) => [
      relative(root, plan.packageJsonPath) || 'package.json',
      ...plan.added.map((change) => `  + ${change}`),
    ])
    fail(
      `Package setup is not current:\n${details.join('\n')}\nRun \`intent setup --write\` and review the changes.`,
    )
  }

  for (const plan of plans) printPlan(root, plan)
  if (options.dryRun) return

  for (const plan of pending) writeEditPackageJsonPlan(plan)
  if (pending.length > 0) {
    console.log(`✅ Updated ${pending.length} package.json file(s)`)
  }
}
