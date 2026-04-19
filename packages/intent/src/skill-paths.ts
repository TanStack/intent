import { existsSync } from 'node:fs'
import { join, relative } from 'node:path'
import type { SkillUse } from './skill-use.js'
import type { SkillEntry } from './types.js'
import { toPosixPath } from './utils.js'

const RUNTIME_SKILL_LOOKUP_COMMENT_PATTERN =
  /^Runtime lookup only: run `npx @tanstack\/intent@latest resolve [^`]+`, and load its reported path for this session\. Do not copy the resolved path into this file\.$/

export function isAbsolutePath(path: string): boolean {
  return (
    path.startsWith('/') ||
    path.startsWith('\\\\') ||
    /^[A-Za-z]:[\\/]/.test(path)
  )
}

function getPathSegments(path: string): Array<string> {
  return path.replace(/\\/g, '/').split('/')
}

function isPackageManagerInternalSegment(segment: string): boolean {
  return segment === '.pnpm' || segment === '.bun' || segment === '.yarn'
}

export function hasPackageManagerInternalPath(path: string): boolean {
  return getPathSegments(path).some(isPackageManagerInternalSegment)
}

export function isStableLoadPath(path: string): boolean {
  const normalized = path.trim()
  const segments = getPathSegments(normalized)
  return (
    normalized !== '' &&
    !isAbsolutePath(normalized) &&
    !segments.includes('..') &&
    !segments.some(isPackageManagerInternalSegment)
  )
}

export function rewriteSkillLoadPaths({
  packageName,
  packageRoot,
  projectRoot,
  skills,
}: {
  packageName: string
  packageRoot: string
  projectRoot: string
  skills: Array<SkillEntry>
}): void {
  const hasStableSymlink =
    packageName !== '' &&
    existsSync(join(projectRoot, 'node_modules', packageName))

  for (const skill of skills) {
    if (hasStableSymlink) {
      const relFromPackage = toPosixPath(relative(packageRoot, skill.path))
      skill.path = `node_modules/${packageName}/${relFromPackage}`
    } else {
      skill.path = toPosixPath(relative(projectRoot, skill.path))
    }
  }
}

export function formatRuntimeSkillLookupComment(target: SkillUse): string {
  return `Runtime lookup only: run \`npx @tanstack/intent@latest resolve ${target.packageName}#${target.skillName}\`, and load its reported path for this session. Do not copy the resolved path into this file.`
}

export function isRuntimeSkillLookupComment(value: string): boolean {
  const comment = value.trim().replace(/^#\s*/, '')
  return RUNTIME_SKILL_LOOKUP_COMMENT_PATTERN.test(comment)
}

export function formatRuntimeSkillLookupHint(target: SkillUse): string {
  return `Lookup: ${formatRuntimeSkillLookupComment(target)}`
}
