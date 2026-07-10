import { realpathSync } from 'node:fs'
import { join } from 'node:path'
import { generateManifest, writeIntentManifest } from '../../core/manifest.js'
import { resolveProjectContext } from '../../core/project-context.js'
import { findWorkspacePackages } from '../../setup/workspace-patterns.js'
import { fail } from '../../shared/cli-error.js'
import { isFrozenMode } from '../../shared/mode.js'
import type { PolicedScan } from '../../core/source-policy.js'

export interface SkillsGenerateManifestCommandOptions {
  frozen?: boolean
  json?: boolean
  noFrozen?: boolean
}

interface GenerateManifestResult {
  id: string
  kind: 'npm' | 'workspace'
  status: 'written' | 'failed'
  path?: string
  reason?: string
}

export async function runSkillsGenerateManifestCommand(
  options: SkillsGenerateManifestCommandOptions,
  scanPolicedIntents: () => Promise<PolicedScan>,
  cwd: string = process.cwd(),
): Promise<void> {
  if (
    isFrozenMode({
      frozen: options.frozen,
      noFrozen: options.noFrozen,
    })
  ) {
    fail('`intent skills generate-manifest` cannot run in frozen mode.', 5)
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
      '`intent skills generate-manifest` only writes the current package or workspace members. Run it from the package you maintain.',
    )
  }
  const results: Array<GenerateManifestResult> = []

  for (const pkg of scan.packages) {
    const outcome = generateManifest(
      pkg.packageRoot,
      pkg.name,
      pkg.version,
      pkg.skills,
    )

    if (!outcome.ok) {
      const reason = outcome.secretFindings
        .map((finding) => `${finding.skillPath} (${finding.patternName})`)
        .join(', ')
      results.push({
        id: pkg.name,
        kind: pkg.kind,
        status: 'failed',
        reason: `literal secret value(s) found: ${reason}`,
      })
      continue
    }

    const manifestPath = join(pkg.packageRoot, 'skills', 'intent.manifest.json')
    writeIntentManifest(manifestPath, outcome.manifest)
    results.push({
      id: pkg.name,
      kind: pkg.kind,
      status: 'written',
      path: manifestPath,
    })
  }

  if (options.json) {
    console.log(JSON.stringify(results, null, 2))
  } else if (results.length === 0) {
    console.log('No intent-enabled packages found.')
  } else {
    for (const result of results) {
      if (result.status === 'written') {
        console.log(`Wrote ${result.path}`)
      } else {
        console.log(`Failed for ${result.kind}:${result.id} — ${result.reason}`)
      }
    }
  }

  if (results.some((result) => result.status === 'failed')) {
    fail(
      'One or more packages failed manifest generation: skill content contains a literal secret value. Declare the secret by name in declaredSecrets, never its value.',
    )
  }
}
