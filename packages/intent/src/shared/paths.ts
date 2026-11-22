import { isAbsolute, relative, sep } from 'node:path'

export function isWithinOrEqual(path: string, parentDir: string): boolean {
  const rel = relative(parentDir, path)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

export function toPosixPath(p: string): string {
  return p.split(sep).join('/')
}

/**
 * Check whether a skill path belongs to the default skill discovery tree.
 *
 * Hidden directories and node_modules are excluded from default discovery,
 * while explicitly declared or custom-root skills can still be handled by
 * their respective discovery paths.
 */
export function isDefaultSkillPath(path: string): boolean {
  return !path
    .split('/')
    .some((part) => part.startsWith('.') || part === 'node_modules')
}

/**
 * Strip the Windows extended-length prefix that `readlink` can report for
 * junction targets. `\\?\C:\dir` becomes `C:\dir`; `\\?\UNC\server\share`
 * becomes `\\server\share` so the UNC root stays absolute. Other targets,
 * including relative POSIX links, are returned unchanged.
 */
export function normalizeReadlinkTarget(target: string): string {
  if (target.startsWith('\\\\?\\UNC\\')) {
    return `\\\\${target.slice(8)}`
  }
  if (target.startsWith('\\\\?\\')) return target.slice(4)
  return target
}
