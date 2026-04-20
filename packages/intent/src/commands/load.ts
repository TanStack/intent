import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, relative, resolve } from 'node:path'
import { fail } from '../cli-error.js'
import { scanOptionsFromGlobalFlags } from '../cli-support.js'
import { resolveSkillUse } from '../resolver.js'
import { parseSkillUse } from '../skill-use.js'
import type { GlobalScanFlags } from '../cli-support.js'
import type { ScanOptions, ScanResult } from '../types.js'

export interface LoadCommandOptions extends GlobalScanFlags {
  json?: boolean
  path?: boolean
}

function resolveFromCwd(path: string): string {
  return resolve(process.cwd(), path)
}

function isPathInsidePackageRoot(path: string, packageRoot: string): boolean {
  const relativePath = relative(resolveFromCwd(packageRoot), resolveFromCwd(path))
  return (
    relativePath === '' ||
    (!relativePath.startsWith('..') && !isAbsolute(relativePath))
  )
}

export async function runLoadCommand(
  use: string | undefined,
  options: LoadCommandOptions,
  scanIntentsOrFail: (options?: ScanOptions) => Promise<ScanResult>,
): Promise<void> {
  if (!use) {
    fail('Missing skill use. Expected: intent load <package>#<skill>')
  }

  if (options.json && options.path) {
    fail('Use either --json or --path, not both.')
  }

  parseSkillUse(use)

  const result = await scanIntentsOrFail(scanOptionsFromGlobalFlags(options))
  const resolved = resolveSkillUse(use, result)
  const resolvedPath = resolveFromCwd(resolved.path)

  if (!isPathInsidePackageRoot(resolved.path, resolved.packageRoot)) {
    fail(
      `Resolved skill path for "${use}" is outside package root: ${resolved.path}`,
    )
  }

  if (!existsSync(resolvedPath)) {
    fail(`Resolved skill file was not found: ${resolved.path}`)
  }

  if (options.path) {
    console.log(resolved.path)
    for (const warning of resolved.warnings) {
      console.error(`Warning: ${warning}`)
    }
    return
  }

  const content = readFileSync(resolvedPath, 'utf8')

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          package: resolved.packageName,
          skill: resolved.skillName,
          path: resolved.path,
          packageRoot: resolved.packageRoot,
          source: resolved.source,
          version: resolved.version,
          content,
          warnings: resolved.warnings,
        },
        null,
        2,
      ),
    )
    return
  }

  process.stdout.write(content)

  for (const warning of resolved.warnings) {
    console.error(`Warning: ${warning}`)
  }
}
