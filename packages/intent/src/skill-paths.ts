export interface SkillLookupTarget {
  packageName?: string
  skillName: string
}

const RUNTIME_SKILL_LOOKUP_COMMENT_PATTERN =
  /^Runtime lookup only: run `npx @tanstack\/intent@latest list --json`, find package "[^"]+" skill "[^"]+", and load its reported path for this session\. Do not copy the resolved path into this file\.$/

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

function formatSkillLookupTarget(target: SkillLookupTarget): string {
  const skill = `skill "${target.skillName}"`
  return target.packageName ? `package "${target.packageName}" ${skill}` : skill
}

export function formatRuntimeSkillLookupComment(
  target: SkillLookupTarget,
): string {
  return `Runtime lookup only: run \`npx @tanstack/intent@latest list --json\`, find ${formatSkillLookupTarget(target)}, and load its reported path for this session. Do not copy the resolved path into this file.`
}

export function isRuntimeSkillLookupComment(value: string): boolean {
  const comment = value.trim().replace(/^#\s*/, '')
  return RUNTIME_SKILL_LOOKUP_COMMENT_PATTERN.test(comment)
}

export function formatRuntimeSkillLookupHint(
  target: SkillLookupTarget,
): string {
  return `Lookup: ${formatRuntimeSkillLookupComment(target)}`
}
