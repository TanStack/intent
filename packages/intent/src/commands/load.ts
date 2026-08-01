import { join } from 'node:path'
import { fail } from '../shared/cli-error.js'
import {
  IntentCoreError,
  loadIntentSkill,
  resolveIntentSkill,
} from '../core/index.js'
import { readIntentLockfile } from '../core/lockfile/lockfile.js'
import { resolveProjectContext } from '../core/project-context.js'
import { parseSkillUse } from '../skills/use.js'
import { printDebugInfo } from './support.js'
import type { LoadedIntentSkill, ResolvedIntentSkill } from '../core/index.js'

export interface LoadCommandOptions {
  debug?: boolean
  json?: boolean
  path?: boolean
}

type LoadAudience = 'agent' | 'human'

function loadAudience(): LoadAudience {
  return process.env.INTENT_AUDIENCE?.trim().toLowerCase() === 'agent'
    ? 'agent'
    : 'human'
}

function reviewInstruction(audience: LoadAudience): string {
  return audience === 'agent'
    ? 'Pause and ask the user to run `intent install` interactively to review and approve skills. Do not continue automatically.'
    : 'Run `intent install` interactively to review and approve skills.'
}

function assertLoadLock(use: string, audience: LoadAudience): void {
  const context = resolveProjectContext({ cwd: process.cwd() })
  const root = context.workspaceRoot ?? context.packageRoot ?? context.cwd
  let status: ReturnType<typeof readIntentLockfile>['status']
  try {
    status = readIntentLockfile(join(root, 'intent.lock')).status
  } catch (error) {
    fail(
      `Cannot load skill use "${use}": intent.lock is invalid: ${error instanceof Error ? error.message : String(error)}. ${reviewInstruction(audience)}`,
    )
  }
  if (status === 'missing') {
    fail(
      `Cannot load skill use "${use}": intent.lock is missing. ${reviewInstruction(audience)}`,
    )
  }
}

function formatLoadFailure(
  error: IntentCoreError,
  use: string,
  audience: LoadAudience,
): string {
  switch (error.code) {
    case 'package-not-found':
      return `Cannot load skill use "${use}": package was not found. Run \`intent list\` to see trusted packages.`
    case 'skill-not-found': {
      const suggestions = error.suggestedSkills ?? []
      if (suggestions.length > 0) {
        const packageName = use.slice(0, use.indexOf('#'))
        const suggestedUses = suggestions.map(
          (skill) => `${packageName}#${skill}`,
        )
        return `Cannot load skill use "${use}": skill was not found. Did you mean ${suggestedUses.join(', ')}?`
      }
      const packageName = use.slice(0, use.indexOf('#'))
      return `Cannot load skill use "${use}": skill was not found. Run \`intent list ${packageName}\` to see available skills.`
    }
    case 'skill-not-accepted':
    case 'skill-content-changed':
      return `${error.message} ${reviewInstruction(audience)}`
    default:
      return error.message
  }
}

function visibleWarnings(
  loaded: LoadedIntentSkill | ResolvedIntentSkill,
  debug: boolean,
): Array<string> {
  if (debug) return loaded.warnings

  return loaded.conflict
    ? [
        `Multiple versions of ${loaded.packageName} are installed; ${loaded.version} was used. Run with --debug to see package paths.`,
      ]
    : []
}

function printLoadDebug(loaded: LoadedIntentSkill | ResolvedIntentSkill): void {
  if (!loaded.debug) return

  printDebugInfo('intent load', [
    ['cwd', loaded.debug.cwd],
    ['scope', loaded.debug.scope],
    ['resolution', loaded.debug.resolution],
    ['excludes', loaded.debug.excludes],
    ['package', loaded.debug.packageName],
    ['version', loaded.debug.version],
    ['source', loaded.debug.source],
    ['skill', loaded.debug.skillName],
    ['path', loaded.debug.path],
    ['warnings', loaded.debug.warningCount],
    ['packageJsonReadCount', loaded.debug.scan.packageJsonReadCount],
    ['packageJsonCacheHits', loaded.debug.scan.packageJsonCacheHits],
  ])
}

export function runLoadCommand(
  use: string | undefined,
  options: LoadCommandOptions,
): void {
  if (!use) {
    fail('Missing skill use. Expected: intent load <package>#<skill>')
  }

  if (options.json && options.path) {
    fail('Use either --json or --path, not both.')
  }

  try {
    parseSkillUse(use)
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error))
  }

  const audience = loadAudience()
  assertLoadLock(use, audience)

  const coreOptions = { debug: options.debug }

  if (options.path) {
    let resolved: ResolvedIntentSkill
    try {
      resolved = resolveIntentSkill(use, coreOptions)
    } catch (err) {
      if (err instanceof IntentCoreError) {
        fail(formatLoadFailure(err, use, audience))
      }
      throw err
    }
    printLoadDebug(resolved)

    console.log(resolved.path)
    for (const warning of visibleWarnings(resolved, options.debug === true)) {
      console.error(`Warning: ${warning}`)
    }
    return
  }

  let loaded: LoadedIntentSkill
  try {
    loaded = loadIntentSkill(use, coreOptions)
  } catch (err) {
    if (err instanceof IntentCoreError) {
      fail(formatLoadFailure(err, use, audience))
    }
    throw err
  }
  printLoadDebug(loaded)

  if (options.json) {
    const redactPaths = audience === 'agent' && options.debug !== true
    console.log(
      JSON.stringify(
        {
          package: loaded.packageName,
          skill: loaded.skillName,
          path: redactPaths ? '' : loaded.path,
          packageRoot: redactPaths ? '' : loaded.packageRoot,
          source: loaded.source,
          version: loaded.version,
          content: loaded.content,
          warnings: visibleWarnings(loaded, options.debug === true),
        },
        null,
        2,
      ),
    )
    return
  }

  process.stdout.write(loaded.content)

  for (const warning of visibleWarnings(loaded, options.debug === true)) {
    console.error(`Warning: ${warning}`)
  }
}
