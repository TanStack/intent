import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import { nodeReadFs, toPosixPath } from '../../shared/utils.js'
import { validateSkillPath } from '../skill-path.js'
import { computeSkillContentHash } from './hash.js'
import type { IntentLockfileSource } from './lockfile.js'
import type { IntentPackage } from '../../shared/types.js'
import type { ReadFs } from '../../shared/utils.js'

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function sourceKey(source: Pick<IntentLockfileSource, 'kind' | 'id'>): string {
  return `${source.kind}\0${source.id}`
}

function packageRelativeSkillFile(
  pkg: IntentPackage,
  skillPath: string,
): string {
  if (isAbsolute(skillPath)) return resolve(skillPath)

  const normalizedSkillPath = toPosixPath(skillPath)
  const nodeModulesPrefix = `node_modules/${pkg.name}/`
  if (normalizedSkillPath.startsWith(nodeModulesPrefix)) {
    return resolve(
      pkg.packageRoot,
      normalizedSkillPath.slice(nodeModulesPrefix.length),
    )
  }

  const packageSegments = toPosixPath(resolve(pkg.packageRoot)).split('/')
  const skillSegments = normalizedSkillPath.split('/')
  const compareSegment =
    sep === '\\'
      ? (left: string, right: string) =>
          left.toLowerCase() === right.toLowerCase()
      : (left: string, right: string) => left === right
  for (let start = 0; start < packageSegments.length; start++) {
    const suffix = packageSegments.slice(start)
    if (
      suffix.length < skillSegments.length &&
      suffix.every((segment, index) =>
        compareSegment(segment, skillSegments[index]!),
      )
    ) {
      return resolve(pkg.packageRoot, ...skillSegments.slice(suffix.length))
    }
  }

  return resolve(pkg.packageRoot, skillPath)
}

function skillDirectoryPath(
  pkg: IntentPackage,
  skillPath: string,
): { absolute: string; relative: string } {
  const absoluteSkillFile = packageRelativeSkillFile(pkg, skillPath)
  const absolute = dirname(absoluteSkillFile)
  const relativePath = relative(resolve(pkg.packageRoot), absolute)
  const packageRelativePath =
    sep === '/' ? relativePath : relativePath.split(sep).join('/')
  return { absolute, relative: validateSkillPath(packageRelativePath) }
}

export function buildCurrentLockfileSources(
  packages: ReadonlyArray<IntentPackage>,
  fs: ReadFs = nodeReadFs,
): Array<IntentLockfileSource> {
  const sources = packages.map((pkg) => ({
    kind: pkg.kind,
    id: pkg.name,
    skills: pkg.skills
      .map((skill) => {
        const path = skillDirectoryPath(pkg, skill.path)
        return {
          path: path.relative,
          contentHash: computeSkillContentHash({
            packageRoot: pkg.packageRoot,
            skillDir: path.absolute,
            fs,
          }),
        }
      })
      .sort((a, b) => compareStrings(a.path, b.path)),
  }))
  const identities = new Set<string>()
  for (const source of sources) {
    const identity = sourceKey(source)
    if (identities.has(identity))
      throw new Error(
        `Duplicate skill source identity: ${source.kind}:${source.id}.`,
      )
    identities.add(identity)
    const paths = new Set(source.skills.map((skill) => skill.path))
    if (paths.size !== source.skills.length)
      throw new Error(
        `Duplicate skill path for source: ${source.kind}:${source.id}.`,
      )
  }
  return sources.sort((a, b) => compareStrings(sourceKey(a), sourceKey(b)))
}
