import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fail } from '../shared/cli-error.js'
import { compileExcludePatterns } from '../core/excludes.js'
import { resolveProjectContext } from '../core/project-context.js'
import { writeTextFileAtomic } from '../shared/atomic-write.js'
import { isExplicitAgentAudience } from '../shared/environment.js'
import {
  readIntentConsumerConfig,
  updateIntentConsumerConfigText,
} from './install/config.js'
import { readIntentDeliveryConfig } from './install/delivery.js'
import type { IntentConsumerConfig } from './install/config.js'

export interface ExcludeCommandOptions {
  json?: boolean
}

type ExcludeAction = 'add' | 'list' | 'remove'

function normalizeAction(action: string | undefined): ExcludeAction {
  if (!action) return 'list'
  if (action === 'list' || action === 'add' || action === 'remove')
    return action
  fail(`Unknown exclude action: ${action}. Expected list, add, or remove.`)
}

function readConfig(text: string): IntentConsumerConfig {
  try {
    return readIntentConsumerConfig(text)
  } catch (err) {
    fail(
      `Invalid package.json intent configuration: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

async function syncDelivery(root: string, dryRun = false): Promise<void> {
  const delivery = readIntentDeliveryConfig(root)
  if (delivery?.method !== 'symlink') return

  const { runSyncCommand } = await import('./sync/command.js')
  await runSyncCommand(
    { cwd: root, dryRun },
    { quiet: true, review: 'reminder' },
  )
}

async function writeAndReconcile(
  root: string,
  text: string,
  config: IntentConsumerConfig,
  excludes: Array<string>,
): Promise<void> {
  const packageJsonPath = join(root, 'package.json')
  await syncDelivery(root, true)
  writeTextFileAtomic(
    packageJsonPath,
    updateIntentConsumerConfigText(text, { ...config, exclude: excludes }),
  )
  try {
    await syncDelivery(root)
  } catch (error) {
    writeTextFileAtomic(packageJsonPath, text)
    try {
      await syncDelivery(root)
    } catch {}
    throw error
  }
}

function normalizePattern(
  pattern: string | undefined,
  action: ExcludeAction,
): string {
  if (!pattern) {
    fail(
      `Missing exclude pattern. Expected: intent exclude ${action} <pattern>`,
    )
  }
  const trimmed = pattern.trim()
  if (trimmed.length === 0) {
    fail(
      `Missing exclude pattern. Expected: intent exclude ${action} <pattern>`,
    )
  }
  return trimmed
}

function validatePattern(pattern: string): void {
  try {
    compileExcludePatterns([pattern])
  } catch (err) {
    fail(
      `Invalid exclude pattern "${pattern}": ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

function printExcludes(excludes: Array<string>, json?: boolean): void {
  if (json) {
    console.log(JSON.stringify(excludes, null, 2))
    return
  }

  if (excludes.length === 0) {
    console.log('No excludes configured.')
    return
  }

  console.log('Configured excludes:')
  for (const pattern of excludes) {
    console.log(`- ${pattern}`)
  }
}

export async function runExcludeCommand(
  actionArg: string | undefined,
  patternArg: string | undefined,
  options: ExcludeCommandOptions,
): Promise<void> {
  const action = normalizeAction(actionArg)
  const cwd = process.cwd()
  const context = resolveProjectContext({ cwd })
  const root = context.workspaceRoot ?? context.packageRoot ?? context.cwd
  const packageJsonPath = join(root, 'package.json')
  if (!existsSync(packageJsonPath)) {
    fail(`No package.json found in ${root}`)
  }
  const text = readFileSync(packageJsonPath, 'utf8')
  const config = readConfig(text)

  if (action === 'list') {
    if (patternArg) {
      fail('Unexpected pattern for list. Use: intent exclude list [--json]')
    }
    printExcludes(config.exclude, options.json)
    return
  }

  if (options.json) {
    fail('JSON output is only available for `intent exclude list`.')
  }

  const currentExcludes = config.exclude

  const pattern = normalizePattern(patternArg, action)
  validatePattern(pattern)

  if (isExplicitAgentAudience()) {
    fail(
      `Pause and ask the user to run \`intent exclude ${action} ${pattern}\` themselves. Do not modify trust policy automatically.`,
    )
  }

  if (action === 'add') {
    if (currentExcludes.includes(pattern)) {
      await syncDelivery(root)
      console.log(`Exclude pattern "${pattern}" is already configured.`)
      return
    }

    const updated = [...currentExcludes, pattern]
    await writeAndReconcile(root, text, config, updated)
    console.log(
      `Added exclude pattern "${pattern}" to package.json intent.exclude.`,
    )
    return
  }

  const updated = currentExcludes.filter((value) => value !== pattern)
  if (updated.length === currentExcludes.length) {
    await syncDelivery(root)
    console.log(`Exclude pattern "${pattern}" is not configured.`)
    return
  }

  await writeAndReconcile(root, text, config, updated)
  console.log(
    `Removed exclude pattern "${pattern}" from package.json intent.exclude.`,
  )
}
