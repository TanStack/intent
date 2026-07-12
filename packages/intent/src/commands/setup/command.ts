import { relative } from 'node:path'
import { fail } from '../../shared/cli-error.js'
import type {
  EditPackageJsonPlan,
  MonorepoResult,
  SetupWorkflowPlan,
} from '../../setup/index.js'

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

function workflowStatusMessage(root: string, plan: SetupWorkflowPlan): string {
  const path = relative(root, plan.workflowPath)
  if (plan.issue === 'template-missing') {
    return `${path}: Intent workflow template is unavailable; reinstall the local @tanstack/intent package`
  }
  if (plan.status === 'missing') return `${path}: create managed workflow`
  if (plan.status === 'stale') return `${path}: update managed workflow`
  if (plan.status === 'current') return `${path}: managed workflow is current`
  return `${path}: existing workflow is custom or modified; Intent will not overwrite it`
}

export async function runSetupCommand(
  root: string,
  metaDir: string,
  intentVersion: string,
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

  const {
    planEditPackageJsonAll,
    planSetupWorkflow,
    writeEditPackageJsonPlan,
    writeSetupWorkflowPlan,
  } = await import('../../setup/index.js')
  const plans = flattenPlans(planEditPackageJsonAll(root))
  if (plans.length === 0) fail('No package.json was found for Intent setup.')
  const workflowPlan = planSetupWorkflow(root, metaDir, intentVersion)

  const pending = plans.filter((plan) => plan.added.length > 0)
  if (options.check) {
    if (pending.length === 0 && workflowPlan.status === 'current') {
      console.log('✅ Package and workflow setup are current')
      return
    }
    const details = pending.flatMap((plan) => [
      relative(root, plan.packageJsonPath) || 'package.json',
      ...plan.added.map((change) => `  + ${change}`),
    ])
    if (workflowPlan.status !== 'current') {
      details.push(workflowStatusMessage(root, workflowPlan))
    }
    fail(
      `Package setup is not current:\n${details.join('\n')}\nRun \`intent setup --write\` and review the changes.`,
    )
  }

  for (const plan of plans) printPlan(root, plan)
  console.log(workflowStatusMessage(root, workflowPlan))
  if (options.dryRun) return

  if (workflowPlan.status === 'conflict') {
    fail(
      `${workflowStatusMessage(root, workflowPlan)}. Move or reconcile that file, then rerun \`intent setup --write\`.`,
    )
  }
  for (const plan of pending) writeEditPackageJsonPlan(plan)
  if (workflowPlan.status === 'missing' || workflowPlan.status === 'stale') {
    writeSetupWorkflowPlan(workflowPlan)
  }
  if (pending.length > 0) {
    console.log(`✅ Updated ${pending.length} package.json file(s)`)
  }
  if (workflowPlan.status !== 'current') {
    console.log('✅ Updated managed workflow')
  }
}
