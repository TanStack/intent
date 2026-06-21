import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fail } from '../shared/cli-error.js'
import { compileExcludePatterns } from '../core/excludes.js'

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

function readPackageJson(cwd: string): Record<string, unknown> {
  const packageJsonPath = getPackageJsonPath(cwd)
  if (!existsSync(packageJsonPath)) {
    fail(`No package.json found in ${cwd}`)
  }

  try {
    return JSON.parse(readFileSync(packageJsonPath, 'utf8')) as Record<
      string,
      unknown
    >
  } catch (err) {
    fail(
      `Failed to parse ${packageJsonPath}: ${err instanceof Error ? err.message : String(err)}`,
    )
  }
}

function readConfiguredExcludes(pkg: Record<string, unknown>): Array<string> {
  const intent = pkg.intent
  if (intent === undefined) return []
  if (!intent || typeof intent !== 'object') {
    fail('Invalid package.json: intent must be an object when present.')
  }

  const raw = (intent as Record<string, unknown>).exclude
  if (raw === undefined) return []
  if (!Array.isArray(raw)) {
    fail('Invalid package.json: intent.exclude must be an array of strings.')
  }

  const excludes: Array<string> = []
  for (const entry of raw) {
    if (typeof entry !== 'string') {
      fail('Invalid package.json: intent.exclude must contain only strings.')
    }
    const trimmed = entry.trim()
    if (trimmed.length === 0) continue
    excludes.push(trimmed)
  }
  return excludes
}

function setConfiguredExcludes(
  pkg: Record<string, unknown>,
  excludes: Array<string>,
): void {
  const intent =
    pkg.intent && typeof pkg.intent === 'object'
      ? (pkg.intent as Record<string, unknown>)
      : {}

  intent.exclude = excludes
  pkg.intent = intent
}

function writePackageJson(cwd: string, pkg: Record<string, unknown>): void {
  const packageJsonPath = getPackageJsonPath(cwd)
  writeFileSync(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
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
  const pkg = readPackageJson(cwd)
  const currentExcludes = readConfiguredExcludes(pkg)

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
    setConfiguredExcludes(pkg, updated)
    writePackageJson(cwd, pkg)
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

  setConfiguredExcludes(pkg, updated)
  writePackageJson(cwd, pkg)
  if (options.json) {
    printExcludes(updated, true)
    return
  }
  console.log(
    `Removed exclude pattern "${pattern}" from package.json intent.exclude.`,
  )
}
