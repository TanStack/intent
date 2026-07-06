import { relative, sep } from 'node:path'
import { sourceIdentityKey } from '../types.js'
import { computeSourceContentHash } from './hash.js'
import type { SourceContentHash } from './hash.js'
import type { IntentLockfileSource } from './lockfile.js'
import type { IntentPackage } from '../../shared/types.js'

function toPosixPath(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/')
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function buildSourceContent(pkg: IntentPackage): SourceContentHash {
  const entries = pkg.skills.map((skill) => ({
    relativePath: toPosixPath(relative(pkg.packageRoot, skill.path)),
    absolutePath: skill.path,
  }))

  return computeSourceContentHash(pkg.packageRoot, entries)
}

function buildResolution(pkg: IntentPackage): string | null {
  return pkg.kind === 'npm' ? `npm:${pkg.name}@${pkg.version}` : null
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
): Array<IntentLockfileSource> {
  const sources = packages
    .map((pkg): IntentLockfileSource => {
      const { skills, contentHash } = buildSourceContent(pkg)
      return {
        id: pkg.name,
        kind: pkg.kind,
        version: pkg.version,
        resolution: buildResolution(pkg),
        skills,
        contentHash,
        manifestHash: null,
        capabilities: null,
      }
    })
    .sort((a, b) => compareStrings(sourceIdentityKey(a), sourceIdentityKey(b)))

  assertUniqueIdentities(sources)

  return sources
}
