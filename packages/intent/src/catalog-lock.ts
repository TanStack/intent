import { join } from 'node:path'
import { createIntentFsCache } from './discovery/fs-cache.js'
import {
  getProjectReadFs,
  scanIntentPackageAtRoot,
} from './discovery/scanner.js'
import { buildCurrentLockfileSkill } from './core/lockfile/lockfile-state.js'
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

function formatWithheldWarning(count: number, reason: string): string {
  return `${count} ${count === 1 ? 'skill was' : 'skills were'} withheld because ${reason}.`
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
  const surfacedUses = new Set(result.skills.map((skill) => skill.use))
  const allowedUses = new Set<string>()
  const verification: Array<CatalogueVerificationEntry> = []
  let pendingCount = 0
  let changedCount = 0
  let unverifiableCount = 0

  for (const summary of result.packages) {
    const scanned = scanIntentPackageAtRoot(summary.packageRoot, {
      fallbackName: summary.name,
      fsCache,
      projectRoot: workspaceRoot,
      source: summary.source,
    }).package
    if (!scanned) continue

    const currentSourceKey = sourceIdentityKey({
      kind: scanned.kind,
      id: scanned.name,
    })
    const lockedSource = locked.lockfile.sources.find(
      (source) => sourceIdentityKey(source) === currentSourceKey,
    )
    const lockedSkills = new Map(
      lockedSource?.skills.map((skill) => [skill.path, skill]) ?? [],
    )
    for (const scannedSkill of scanned.skills) {
      const use = formatSkillUse(scanned.name, scannedSkill.name)
      if (!surfacedUses.has(use)) continue

      let skill: ReturnType<typeof buildCurrentLockfileSkill>
      try {
        skill = buildCurrentLockfileSkill(
          scanned,
          scannedSkill,
          fsCache.getReadFs(),
        )
      } catch {
        unverifiableCount += 1
        continue
      }
      verification.push({
        packageRoot: summary.packageRoot,
        skillPath: skill.path,
        contentHash: skill.contentHash,
      })
      const status = classifyLockfileHash(
        skill.contentHash,
        lockedSkills.get(skill.path)?.contentHash,
      )
      if (status === 'accepted') {
        allowedUses.add(use)
      } else {
        if (status === 'new') pendingCount += 1
        else changedCount += 1
      }
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
  const warnings = [...result.warnings]
  for (const [count, reason] of [
    [pendingCount, 'no matching intent.lock entry exists'],
    [changedCount, 'installed content does not match intent.lock'],
    [unverifiableCount, 'installed content could not be verified'],
  ] as const) {
    if (count > 0) warnings.push(formatWithheldWarning(count, reason))
  }

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
    verification: unverifiableCount > 0 ? null : verification,
  }
}
