import { join } from 'node:path'
import { createIntentFsCache } from './discovery/fs-cache.js'
import {
  getProjectReadFs,
  scanIntentPackageAtRoot,
} from './discovery/scanner.js'
import { buildCurrentLockfileSources } from './core/lockfile/lockfile-state.js'
import {
  classifyLockfileHash,
  readIntentLockfile,
} from './core/lockfile/lockfile.js'
import { sourceIdentityKey } from './core/types.js'
import { formatSkillUse } from './skills/use.js'
import type { CatalogueVerificationEntry } from './session-catalog.js'
import type { IntentSkillList } from './core/index.js'
import type { ReadFs } from './shared/utils.js'

export interface LockCheckedCatalogueDiscovery {
  result: IntentSkillList
  verification: Array<CatalogueVerificationEntry> | null
}

export function applyCatalogueLock(
  result: IntentSkillList,
  workspaceRoot: string,
  readFs: ReadFs = getProjectReadFs(workspaceRoot),
): LockCheckedCatalogueDiscovery {
  const locked = readIntentLockfile(join(workspaceRoot, 'intent.lock'))
  if (locked.status === 'missing') return { result, verification: null }

  const fsCache = createIntentFsCache()
  fsCache.useFs(readFs)
  const allowedUses = new Set<string>()
  const verification: Array<CatalogueVerificationEntry> = []

  for (const summary of result.packages) {
    const scanned = scanIntentPackageAtRoot(summary.packageRoot, {
      fallbackName: summary.name,
      fsCache,
      projectRoot: workspaceRoot,
      source: summary.source,
    }).package
    if (!scanned) continue

    const currentSource = buildCurrentLockfileSources(
      [scanned],
      fsCache.getReadFs(),
    )[0]
    if (!currentSource) continue
    const currentSourceKey = sourceIdentityKey(currentSource)
    const lockedSource = locked.lockfile.sources.find(
      (source) => sourceIdentityKey(source) === currentSourceKey,
    )
    if (!lockedSource) continue

    const lockedSkills = new Map(
      lockedSource.skills.map((skill) => [skill.path, skill]),
    )
    for (const skill of currentSource.skills) {
      if (
        classifyLockfileHash(
          skill.contentHash,
          lockedSkills.get(skill.path)?.contentHash,
        ) !== 'accepted'
      )
        continue
      const skillName = skill.path.slice('skills/'.length)
      allowedUses.add(formatSkillUse(currentSource.id, skillName))
      verification.push({
        packageRoot: summary.packageRoot,
        skillPath: skill.path,
        contentHash: skill.contentHash,
      })
    }
  }

  const skills = result.skills.filter((skill) => allowedUses.has(skill.use))
  const skillCountByPackage = new Map<string, number>()
  for (const skill of skills) {
    skillCountByPackage.set(
      skill.packageRoot,
      (skillCountByPackage.get(skill.packageRoot) ?? 0) + 1,
    )
  }
  const packages = result.packages.flatMap((pkg) => {
    const skillCount = skillCountByPackage.get(pkg.packageRoot) ?? 0
    return skillCount > 0 ? [{ ...pkg, skillCount }] : []
  })
  const withheldCount = result.skills.length - skills.length
  const warnings =
    withheldCount > 0
      ? [
          ...result.warnings,
          `${withheldCount} ${withheldCount === 1 ? 'skill was' : 'skills were'} withheld because installed content does not match intent.lock.`,
        ]
      : result.warnings

  return {
    result: {
      ...result,
      skills,
      packages,
      warnings,
      ...(result.debug
        ? {
            debug: {
              ...result.debug,
              packageCount: packages.length,
              skillCount: skills.length,
              warningCount: warnings.length,
            },
          }
        : {}),
    },
    verification: withheldCount > 0 ? null : verification,
  }
}
