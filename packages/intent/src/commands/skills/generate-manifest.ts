import { readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import {
  generateManifest,
  readIntentManifest,
  serializeManifest,
  writeIntentManifest,
} from '../../core/manifest.js'
import { resolveProjectContext } from '../../core/project-context.js'
import { findWorkspacePackages } from '../../setup/workspace-patterns.js'
import { fail } from '../../shared/cli-error.js'
import { isFrozenMode } from '../../shared/mode.js'
import type { ManifestGenerationResult } from '../../core/manifest.js'
import type { PolicedScan } from '../../core/source-policy.js'

export interface SkillsGenerateManifestCommandOptions {
  check?: boolean
  frozen?: boolean
  json?: boolean
  noFrozen?: boolean
  write?: boolean
}

type GenerateManifestStatus = 'clean' | 'stale' | 'written'

interface GenerateManifestResult {
  id: string
  kind: 'npm' | 'workspace'
  status: GenerateManifestStatus
  path: string
  changes: ManifestGenerationResult['changes']
}

function formatChangeSummary(
  changes: ManifestGenerationResult['changes'],
): string {
  return `${changes.added.length} added, ${changes.removed.length} removed, ${changes.updated.length} updated`
}

function printResults(results: Array<GenerateManifestResult>): void {
  if (results.length === 0) {
    console.log('No intent-enabled packages found.')
    return
  }

  for (const result of results) {
    if (result.status === 'clean') {
      console.log(`Manifest is up to date: ${result.path}`)
      continue
    }

    const summary = formatChangeSummary(result.changes)
    if (result.status === 'written') {
      console.log(`Wrote ${result.path} (${summary})`)
    } else {
      console.log(`Manifest is stale: ${result.path} (${summary})`)
    }
  }
}

export async function runSkillsGenerateManifestCommand(
  options: SkillsGenerateManifestCommandOptions,
  scanPolicedIntents: () => Promise<PolicedScan>,
  cwd: string = process.cwd(),
): Promise<void> {
  if (Boolean(options.check) === Boolean(options.write)) {
    fail(
      'Use either --check or --write with `intent skills generate-manifest`.',
    )
  }

  if (
    options.write &&
    isFrozenMode({ frozen: options.frozen, noFrozen: options.noFrozen })
  ) {
    fail('`intent skills generate-manifest` cannot write in frozen mode.', 5)
  }

  const { scan } = await scanPolicedIntents()
  const context = resolveProjectContext({ cwd })
  const ownedRoots = new Set(
    [
      context.packageRoot,
      ...(context.workspaceRoot
        ? findWorkspacePackages(context.workspaceRoot)
        : []),
    ]
      .filter((root): root is string => root !== null)
      .map((root) => realpathSync(root)),
  )
  const unowned = scan.packages.filter(
    (pkg) => !ownedRoots.has(realpathSync(pkg.packageRoot)),
  )
  if (unowned.length > 0) {
    fail(
      '`intent skills generate-manifest` only checks or writes the current package or workspace members. Run it from the package you maintain.',
    )
  }

  const results = scan.packages.map((pkg): GenerateManifestResult => {
    const manifestPath = join(pkg.packageRoot, 'skills', 'intent.manifest.json')
    const existing = readIntentManifest(manifestPath)
    const generated = generateManifest(
      pkg.packageRoot,
      pkg.name,
      pkg.version,
      pkg.skills,
      existing,
      scan.readFs,
    )
    const expected = serializeManifest(generated.manifest)
    const current = existing ? readFileSync(manifestPath, 'utf8') : null
    const clean = current === expected

    if (clean) {
      return {
        id: pkg.name,
        kind: pkg.kind,
        status: 'clean',
        path: manifestPath,
        changes: generated.changes,
      }
    }

    if (options.write) {
      writeIntentManifest(manifestPath, generated.manifest)
    }
    return {
      id: pkg.name,
      kind: pkg.kind,
      status: options.write ? 'written' : 'stale',
      path: manifestPath,
      changes: generated.changes,
    }
  })

  if (options.json) {
    console.log(JSON.stringify(results, null, 2))
  } else {
    printResults(results)
  }

  if (options.check && results.some((result) => result.status === 'stale')) {
    fail(
      'One or more manifests are missing or stale. Run `intent skills generate-manifest --write` and review the changes.',
    )
  }
}
