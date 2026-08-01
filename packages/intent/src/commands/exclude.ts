import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fail } from '../shared/cli-error.js'
import { compileExcludePatterns } from '../core/excludes.js'
import { resolveProjectContext } from '../core/project-context.js'
import { writeTextFileAtomic } from '../shared/atomic-write.js'
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

function getPackageJsonPath(cwd: string): string {
  const context = resolveProjectContext({ cwd })
  const root = context.workspaceRoot ?? context.packageRoot ?? context.cwd
  return join(root, 'package.json')
}

function readPackageJsonText(cwd: string): string {
  const packageJsonPath = getPackageJsonPath(cwd)
  if (!existsSync(packageJsonPath)) {
    fail(`No package.json found in ${cwd}`)
  }
  return readFileSync(packageJsonPath, 'utf8')
}

function getProjectRoot(cwd: string): string {
  const context = resolveProjectContext({ cwd })
  return context.workspaceRoot ?? context.packageRoot ?? context.cwd
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

function writeExcludes(
  cwd: string,
  text: string,
  config: IntentConsumerConfig,
  excludes: Array<string>,
): void {
  writeTextFileAtomic(
    getPackageJsonPath(cwd),
    updateIntentConsumerConfigText(text, { ...config, exclude: excludes }),
  )
}

async function reconcileDelivery(cwd: string): Promise<void> {
  const root = getProjectRoot(cwd)
  const delivery = readIntentDeliveryConfig(root)
  if (delivery?.method !== 'symlink') return

  const { runSyncCommand } = await import('./sync/command.js')
  await runSyncCommand({ cwd: root }, { quiet: true, review: 'reminder' })
}

async function preflightDelivery(cwd: string): Promise<void> {
  const root = getProjectRoot(cwd)
  const delivery = readIntentDeliveryConfig(root)
  if (delivery?.method !== 'symlink') return

  const { runSyncCommand } = await import('./sync/command.js')
  await runSyncCommand(
    { cwd: root, dryRun: true },
    { quiet: true, review: 'reminder' },
  )
}

async function writeAndReconcile(
  cwd: string,
  text: string,
  config: IntentConsumerConfig,
  excludes: Array<string>,
): Promise<void> {
  const packageJsonPath = getPackageJsonPath(cwd)
  await preflightDelivery(cwd)
  writeExcludes(cwd, text, config, excludes)
  try {
    await reconcileDelivery(cwd)
  } catch (error) {
    writeTextFileAtomic(packageJsonPath, text)
    try {
      await reconcileDelivery(cwd)
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
  const text = readPackageJsonText(cwd)
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

  if (process.env.INTENT_AUDIENCE?.trim().toLowerCase() === 'agent') {
    fail(
      `Pause and ask the user to run \`intent exclude ${action} ${pattern}\` themselves. Do not modify trust policy automatically.`,
    )
  }

  if (action === 'add') {
    if (currentExcludes.includes(pattern)) {
      await reconcileDelivery(cwd)
      console.log(`Exclude pattern "${pattern}" is already configured.`)
      return
    }

    const updated = [...currentExcludes, pattern]
    await writeAndReconcile(cwd, text, config, updated)
    console.log(
      `Added exclude pattern "${pattern}" to package.json intent.exclude.`,
    )
    return
  }

  const updated = currentExcludes.filter((value) => value !== pattern)
  if (updated.length === currentExcludes.length) {
    await reconcileDelivery(cwd)
    console.log(`Exclude pattern "${pattern}" is not configured.`)
    return
  }

  await writeAndReconcile(cwd, text, config, updated)
  console.log(
    `Removed exclude pattern "${pattern}" from package.json intent.exclude.`,
  )
}
