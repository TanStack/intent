import { lstatSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

// Resolve instruction aliases within the repository while rejecting escaping
// or dangling links, including links in parent directories. Return the actual
// in-repository destination so an atomic write preserves the alias itself.
export function repositoryWritePath(root: string, path: string): string {
  const canonicalRoot = realpathSync(root)
  const check = (base: string, target: string) => {
    const local = relative(base, target)
    if (
      isAbsolute(local) ||
      local
        .split(sep)
        .some((part) => ['..', '.git', 'node_modules'].includes(part))
    )
      throw new Error(`Unsafe repository write path: ${path}`)
    return local
  }
  const local = check(resolve(root), resolve(path))
  let current = canonicalRoot
  for (const part of local.split(sep)) {
    current = join(current, part)
    let link: boolean
    try {
      link = lstatSync(current).isSymbolicLink()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      continue
    }
    if (link) {
      // realpath also rejects dangling links and cycles instead of treating
      // them as absent files that writeFile would follow.
      current = realpathSync(current)
      check(canonicalRoot, current)
    }
  }
  return join(root, check(canonicalRoot, current))
}
