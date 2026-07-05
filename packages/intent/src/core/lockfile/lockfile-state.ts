import { dirname, relative, sep } from 'node:path'
import { sourceIdentityKey } from '../types.js'
import { hashSkillFolder, hashSourceContent } from './hash.js'
import type { IntentLockfileSource } from './lockfile.js'
import type { IntentPackage } from '../../shared/types.js'

function toPosixPath(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/')
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

// A nested SKILL.md is its own skill root, not part of the parent's content,
// so the parent's hash must exclude it or double-count its bytes.
function buildSourceContentHash(pkg: IntentPackage): string {
  const skillDirs = pkg.skills.map((skill) => dirname(skill.path))

  const skillHashes = skillDirs.map((skillDir, index) => {
    const otherSkillDirs = skillDirs.filter((_, i) => i !== index)

    return {
      skillPath: toPosixPath(relative(pkg.packageRoot, skillDir)),
      hash: hashSkillFolder(skillDir, otherSkillDirs),
    }
  })

  return hashSourceContent(skillHashes)
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
    .map(
      (pkg): IntentLockfileSource => ({
        id: pkg.name,
        kind: pkg.kind,
        version: pkg.version,
        resolution: buildResolution(pkg),
        manifestHash: null,
        contentHash: buildSourceContentHash(pkg),
        capabilities: [],
        declaredSecrets: [],
        mcpTools: [],
        mcpPolicy: {},
      }),
    )
    .sort((a, b) => compareStrings(sourceIdentityKey(a), sourceIdentityKey(b)))

  assertUniqueIdentities(sources)

  return sources
}
