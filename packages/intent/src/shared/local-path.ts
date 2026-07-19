const STRONG_LOCAL_PATH_PATTERN =
  /(?:^|[\s"'`(]|\[)(?:file:(?:\/{1,3}|[A-Za-z]:[\\/])|\.{1,2}[\\/]|~[\\/]|[A-Za-z]:[\\/]|\\\\[^\\\s]+[\\/])/i
const PACKAGE_INTERNAL_PATH_PATTERN =
  /(?:^|[\s"'`(]|\[)[^\s"'`]*(?:node_modules|\.pnpm|\.bun|\.yarn|\.intent)[\\/]/i
const POSIX_PATH_PATTERN = /(?:^|[\s"'`(]|\[)(\/[^\s"'`)\],;]+)/g
const ALWAYS_LOCAL_POSIX_ROOTS = new Set([
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
const USER_LOCAL_POSIX_ROOTS = new Set([
  'Users',
  'Volumes',
  'home',
  'media',
  'mnt',
  'opt',
  'srv',
  'workspace',
])

export function containsLocalPath(value: string): boolean {
  if (
    STRONG_LOCAL_PATH_PATTERN.test(value) ||
    PACKAGE_INTERNAL_PATH_PATTERN.test(value)
  ) {
    return true
  }

  for (const match of value.matchAll(POSIX_PATH_PATTERN)) {
    const path = match[1]!.replace(/[.!?:]+$/, '')
    const segments = path.slice(1).split('/').filter(Boolean)
    const root = segments[0]
    const last = segments.at(-1) ?? ''
    const fileLike = last.startsWith('.') || /\.[A-Za-z0-9][\w.-]*$/.test(last)

    if (
      fileLike ||
      (root && ALWAYS_LOCAL_POSIX_ROOTS.has(root)) ||
      (root && USER_LOCAL_POSIX_ROOTS.has(root) && segments.length >= 3)
    ) {
      return true
    }
  }

  return false
}
