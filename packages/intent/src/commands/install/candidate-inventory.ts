import { join } from 'node:path'
import {
  compileExcludePatterns,
  getEffectiveExcludePatterns,
  isPackageExcluded,
  isSkillExcluded,
} from '../../core/excludes.js'
import { buildCurrentLockfileSources } from '../../core/lockfile/lockfile-state.js'
import { resolveProjectContext } from '../../core/project-context.js'
import {
  compileSkillSourcePolicy,
  readSkillSourcesConfig,
} from '../../core/source-policy.js'
import { sourceIdentityKey } from '../../core/types.js'
import { scanForIntentSources } from '../../discovery/scanner.js'
import { getDeps } from '../../shared/utils.js'
import { formatSkillUse } from '../../skills/use.js'
import type { IntentCoreOptions } from '../../core/types.js'
import type { ReadFs } from '../../shared/utils.js'
import type {
  IntentPackage,
  PackageManager,
  ScanOptions,
  VersionConflict,
} from '../../shared/types.js'

type InstallCandidateProvenance = 'workspace' | 'direct' | 'transitive'

interface InstallCandidateSkill {
  name: string
  description: string
  type?: string
  framework?: string
  use: string
  path: string
  contentHash: string
  permitted: boolean
  excluded: boolean
}

interface InstallCandidateSource {
  kind: IntentPackage['kind']
  id: string
  observedVersion: string
  packageRoot: string
  source: IntentPackage['source']
  provenance: InstallCandidateProvenance
  permitted: boolean
  excluded: boolean
  skills: Array<InstallCandidateSkill>
}

export interface InstallCandidateInventory {
  packageManager: PackageManager
  sources: Array<InstallCandidateSource>
  warnings: Array<string>
  conflicts: Array<VersionConflict>
  readFs: ReadFs
}

export interface InstallCandidateInventoryOptions {
  scanOptions?: ScanOptions
  coreOptions?: IntentCoreOptions
}

function readDirectDependencyNames(root: string, readFs: ReadFs): Set<string> {
  try {
    const parsed = JSON.parse(
      readFs.readFileSync(join(root, 'package.json'), 'utf8'),
    ) as unknown
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      Array.isArray(parsed)
    ) {
      return new Set()
    }
    return new Set(getDeps(parsed as Record<string, unknown>, true))
  } catch {
    return new Set()
  }
}

function getProvenance(
  pkg: IntentPackage,
  directDependencyNames: Set<string>,
): InstallCandidateProvenance {
  if (pkg.kind === 'workspace') return 'workspace'
  if (pkg.source === 'local' && directDependencyNames.has(pkg.name)) {
    return 'direct'
  }
  return 'transitive'
}

export function scanInstallCandidateInventory(
  root: string,
  options: InstallCandidateInventoryOptions = {},
): InstallCandidateInventory {
  const sourceScan = scanForIntentSources(root, options.scanOptions)
  const canonicalSources = buildCurrentLockfileSources(
    sourceScan.sources,
    sourceScan.readFs,
  )
  const context = resolveProjectContext({ cwd: root })
  const config = readSkillSourcesConfig(context.cwd, context)
  const excludeMatchers = compileExcludePatterns(
    getEffectiveExcludePatterns(options.coreOptions, context),
  )
  const policy = compileSkillSourcePolicy(config)
  const directDependencyNames = readDirectDependencyNames(
    context.cwd,
    sourceScan.readFs,
  )
  const discoveredSources = new Map(
    sourceScan.sources.map((pkg) => [
      sourceIdentityKey({ kind: pkg.kind, id: pkg.name }),
      pkg,
    ]),
  )

  const sources = canonicalSources.map((canonicalSource) => {
    const pkg = discoveredSources.get(sourceIdentityKey(canonicalSource))!
    const packagePermitted = policy.permitsPackage(pkg.name, pkg.kind)
    const packageExcluded = isPackageExcluded(pkg.name, excludeMatchers)
    const discoveredSkills = new Map(
      pkg.skills.map((skill) => [skill.name, skill]),
    )

    return {
      kind: canonicalSource.kind,
      id: canonicalSource.id,
      observedVersion: canonicalSource.observedVersion,
      packageRoot: pkg.packageRoot,
      source: pkg.source,
      provenance: getProvenance(pkg, directDependencyNames),
      permitted: packagePermitted,
      excluded: packageExcluded,
      skills: canonicalSource.skills.map((canonicalSkill) => {
        const skillName = canonicalSkill.path.slice('skills/'.length)
        const skill = discoveredSkills.get(skillName)!
        return {
          name: skill.name,
          description: skill.description,
          ...(skill.type === undefined ? {} : { type: skill.type }),
          ...(skill.framework === undefined
            ? {}
            : { framework: skill.framework }),
          use: formatSkillUse(pkg.name, skill.name),
          path: canonicalSkill.path,
          contentHash: canonicalSkill.contentHash,
          permitted:
            packagePermitted &&
            policy.permitsSkill(pkg.name, skill.name, pkg.kind, pkg.skills),
          excluded: isSkillExcluded(pkg.name, skill.name, excludeMatchers),
        }
      }),
    }
  })

  return {
    packageManager: sourceScan.scan.packageManager,
    sources,
    warnings: sourceScan.scan.warnings,
    conflicts: sourceScan.scan.conflicts,
    readFs: sourceScan.readFs,
  }
}
