export interface SkillLookupTarget {
  packageName?: string
  skillName: string
}

export function isAbsolutePath(path: string): boolean {
  return (
    path.startsWith('/') ||
    path.startsWith('\\\\') ||
    /^[A-Za-z]:[\\/]/.test(path)
  )
}

export function hasPackageManagerInternalPath(path: string): boolean {
  const segments = path.replace(/\\/g, '/').split('/')
  return (
    segments.includes('.pnpm') ||
    segments.includes('.bun') ||
    segments.includes('.yarn')
  )
}

export function isStableLoadPath(path: string): boolean {
  return (
    path.trim() !== '' &&
    !isAbsolutePath(path) &&
    !hasPackageManagerInternalPath(path)
  )
}

function formatSkillLookupTarget(target: SkillLookupTarget): string {
  const skill = `skill "${target.skillName}"`
  return target.packageName
    ? `package "${target.packageName}" ${skill}`
    : skill
}

export function formatRuntimeSkillLookupComment(
  target: SkillLookupTarget,
): string {
  return `Runtime lookup only: run \`npx @tanstack/intent@latest list --json\`, find ${formatSkillLookupTarget(target)}, and load its reported path for this session. Do not copy the resolved path into this file.`
}

export function formatRuntimeSkillLookupHint(
  target: SkillLookupTarget,
): string {
  return `Lookup: ${formatRuntimeSkillLookupComment(target)}`
}
