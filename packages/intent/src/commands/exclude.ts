import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fail } from '../shared/cli-error.js'
import { compileExcludePatterns } from '../core/excludes.js'
import { writeTextFileAtomic } from '../shared/atomic-write.js'
import {
  readIntentConsumerConfig,
  updateIntentConsumerConfigText,
} from './install/config.js'
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
  return join(cwd, 'package.json')
}

function readPackageJsonText(cwd: string): string {
  const packageJsonPath = getPackageJsonPath(cwd)
  if (!existsSync(packageJsonPath)) {
    fail(`No package.json found in ${cwd}`)
  }
  return readFileSync(packageJsonPath, 'utf8')
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

export function runExcludeCommand(
  actionArg: string | undefined,
  patternArg: string | undefined,
  options: ExcludeCommandOptions,
): void {
  const action = normalizeAction(actionArg)
  const cwd = process.cwd()
  const text = readPackageJsonText(cwd)
  const config = readConfig(text)
  const currentExcludes = config.exclude

  if (action === 'list') {
    if (patternArg) {
      fail('Unexpected pattern for list. Use: intent exclude list [--json]')
    }
    printExcludes(currentExcludes, options.json)
    return
  }

  const pattern = normalizePattern(patternArg, action)
  validatePattern(pattern)

  if (action === 'add') {
    if (currentExcludes.includes(pattern)) {
      if (options.json) {
        printExcludes(currentExcludes, true)
        return
      }
      console.log(`Exclude pattern "${pattern}" is already configured.`)
      return
    }

    const updated = [...currentExcludes, pattern]
    writeExcludes(cwd, text, config, updated)
    if (options.json) {
      printExcludes(updated, true)
      return
    }
    console.log(
      `Added exclude pattern "${pattern}" to package.json intent.exclude.`,
    )
    return
  }

  const updated = currentExcludes.filter((value) => value !== pattern)
  if (updated.length === currentExcludes.length) {
    if (options.json) {
      printExcludes(currentExcludes, true)
      return
    }
    console.log(`Exclude pattern "${pattern}" is not configured.`)
    return
  }

  writeExcludes(cwd, text, config, updated)
  if (options.json) {
    printExcludes(updated, true)
    return
  }
  console.log(
    `Removed exclude pattern "${pattern}" from package.json intent.exclude.`,
  )
}
