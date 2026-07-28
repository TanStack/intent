const EXPLICIT_LOCAL_PATH_PATTERN =
  /(?:^|[\s"'`(]|\[)(?:file:(?:\/{1,3}|[A-Za-z]:[\\/])|\.{1,2}[\\/]|~[\\/]|[A-Za-z]:[\\/]|\\\\[^\\\s]+[\\/])/i
const PACKAGE_MANAGER_PATH_PATTERN =
  /(?:^|[\s"'`(]|\[)[^\s"'`]*(?:node_modules|\.pnpm|\.bun|\.yarn|\.intent)[\\/]/i
const POSIX_PATH_CANDIDATE_PATTERN = /(?:^|[\s"'`(]|\[)(\/[^\s"'`)\],;]+)/g
const SYSTEM_POSIX_ROOTS = new Set([
  'Applications',
  'Library',
  'System',
  'bin',
  'boot',
  'dev',
  'etc',
  'lib',
  'lib64',
  'private',
  'proc',
  'root',
  'run',
  'sbin',
  'sys',
  'tmp',
  'usr',
  'var',
])
const USER_DATA_POSIX_ROOTS = new Set([
  'Users',
  'Volumes',
  'home',
  'media',
  'mnt',
  'opt',
  'srv',
  'workspace',
])
const HOME_POSIX_ROOTS = new Set(['Users', 'home'])

export function containsLocalPath(value: string): boolean {
  if (
    EXPLICIT_LOCAL_PATH_PATTERN.test(value) ||
    PACKAGE_MANAGER_PATH_PATTERN.test(value)
  ) {
    return true
  }

  for (const match of value.matchAll(POSIX_PATH_CANDIDATE_PATTERN)) {
    if (isLikelyLocalPosixPath(match[1]!)) return true
  }

  return false
}

function isLikelyLocalPosixPath(candidate: string): boolean {
  const path = candidate.replace(/[.!?:]+$/, '')
  const segments = path.slice(1).split('/').filter(Boolean)
  const root = segments[0]
  const leaf = segments.at(-1) ?? ''

  return (
    looksLikeFileName(leaf) ||
    (root !== undefined && SYSTEM_POSIX_ROOTS.has(root)) ||
    (root !== undefined &&
      USER_DATA_POSIX_ROOTS.has(root) &&
      (segments.length >= 3 ||
        (HOME_POSIX_ROOTS.has(root) && segments.length >= 2)))
  )
}

function looksLikeFileName(value: string): boolean {
  return value.startsWith('.') || /\.[A-Za-z0-9][\w.-]*$/.test(value)
}
