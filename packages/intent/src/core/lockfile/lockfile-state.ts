import { join, relative, sep } from 'node:path'
import { sourceIdentityKey } from '../types.js'
import { nodeReadFs } from '../../shared/utils.js'
import {
  assertManifestMatchesPackage,
  computeManifestHash,
  readIntentManifest,
} from '../manifest.js'
import { computeSourceContentHash } from './hash.js'
import type { SourceContentHash } from './hash.js'
import type { IntentLockfileSource } from './lockfile.js'
import type { IntentPackage } from '../../shared/types.js'
import type { ReadFs } from '../../shared/utils.js'

function toPosixPath(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/')
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function buildSourceContent(pkg: IntentPackage, fs: ReadFs): SourceContentHash {
  const entries = pkg.skills.map((skill) => ({
    relativePath: toPosixPath(relative(pkg.packageRoot, skill.path)),
    absolutePath: skill.path,
  }))

  return computeSourceContentHash(pkg.packageRoot, entries, fs)
}

function buildResolution(pkg: IntentPackage): string | null {
  return pkg.kind === 'npm' ? `npm:${pkg.name}@${pkg.version}` : null
}

// manifestHash/capabilities stay null when a package ships no M3 manifest —
// reserved-nullable by design, so the lockfile works before every package
// adopts a manifest. When a manifest is present, its declared capabilities
// (unioned across skills) and hash join the lockfile source entry.
function readManifestFields(
  pkg: IntentPackage,
  fs: ReadFs,
): {
  manifestHash: string | null
  capabilities: Array<string> | null
} {
  const manifest = readIntentManifest(
    join(pkg.packageRoot, 'skills', 'intent.manifest.json'),
    fs,
  )
  if (!manifest) {
    return { manifestHash: null, capabilities: null }
  }
  assertManifestMatchesPackage(
    manifest,
    pkg.packageRoot,
    pkg.name,
    pkg.version,
    pkg.skills,
    fs,
  )

  const capabilities = [
    ...new Set(manifest.skills.flatMap((skill) => skill.capabilities)),
  ].sort(compareStrings)

  return {
    manifestHash: computeManifestHash(manifest),
    capabilities,
  }
}

function assertUniqueIdentities(
  sources: ReadonlyArray<IntentLockfileSource>,
): void {
  const seen = new Set<string>()
  for (const source of sources) {
    const key = sourceIdentityKey(source)
    if (seen.has(key)) {
      throw new Error(
        `Duplicate skill source identity: ${source.kind}:${source.id}.`,
      )
    }
    seen.add(key)
  }
}

export function buildCurrentLockfileSources(
  packages: ReadonlyArray<IntentPackage>,
  fs: ReadFs = nodeReadFs,
): Array<IntentLockfileSource> {
  const sources = packages
    .map((pkg): IntentLockfileSource => {
      const { skills, contentHash } = buildSourceContent(pkg, fs)
      const { manifestHash, capabilities } = readManifestFields(pkg, fs)
      return {
        id: pkg.name,
        kind: pkg.kind,
        version: pkg.version,
        resolution: buildResolution(pkg),
        skills,
        contentHash,
        manifestHash,
        capabilities,
      }
    })
    .sort((a, b) => compareStrings(sourceIdentityKey(a), sourceIdentityKey(b)))

  assertUniqueIdentities(sources)

  return sources
}
