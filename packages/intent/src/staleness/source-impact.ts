import picomatch from 'picomatch'

export interface SourceMappedSkill {
  name: string
  path: string
  sources?: ReadonlyArray<string>
}

export interface AffectedSkill {
  name: string
  path: string
  matchedSources: Array<string>
  changedPaths: Array<string>
}

export interface SourceImpactResult {
  affectedSkills: Array<AffectedSkill>
  unmappedPaths: Array<string>
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function joinPosixPath(prefix: string, path: string): string {
  return prefix ? `${prefix.replace(/\/$/, '')}/${path}` : path
}

export function analyzeSourceImpact(
  skills: ReadonlyArray<SourceMappedSkill>,
  changedPaths: ReadonlyArray<string>,
  packagePath = '',
): SourceImpactResult {
  const canonicalChangedPaths = [...new Set(changedPaths)].sort(compareStrings)
  const mappedPaths = new Set<string>()
  const affectedSkills: Array<AffectedSkill> = []

  for (const skill of skills) {
    const sources = [...new Set(skill.sources ?? [])].sort(compareStrings)
    const matchers = sources.map((source) => ({
      source,
      matches: picomatch(joinPosixPath(packagePath, source), {
        dot: true,
        nonegate: true,
      }),
    }))
    const matchedSources = new Set<string>()
    const matchedPaths: Array<string> = []

    for (const changedPath of canonicalChangedPaths) {
      let pathMatched = false
      for (const matcher of matchers) {
        if (!matcher.matches(changedPath)) continue
        matchedSources.add(matcher.source)
        mappedPaths.add(changedPath)
        pathMatched = true
      }
      if (pathMatched) {
        matchedPaths.push(changedPath)
      }
    }

    if (matchedPaths.length > 0) {
      affectedSkills.push({
        name: skill.name,
        path: skill.path,
        matchedSources: [...matchedSources].sort(compareStrings),
        changedPaths: matchedPaths,
      })
    }
  }

  return {
    affectedSkills: affectedSkills.sort((a, b) =>
      compareStrings(a.path, b.path),
    ),
    unmappedPaths: canonicalChangedPaths.filter((path) => !mappedPaths.has(path)),
  }
}
