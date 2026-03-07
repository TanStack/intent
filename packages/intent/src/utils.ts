import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { parse as parseYaml } from 'yaml'

/**
 * Recursively find all SKILL.md files under a directory.
 */
export function findSkillFiles(dir: string): Array<string> {
  const files: Array<string> = []
  if (!existsSync(dir)) return files
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...findSkillFiles(fullPath))
    } else if (entry.name === 'SKILL.md') {
      files.push(fullPath)
    }
  }
  return files
}

/**
 * Read dependencies and peerDependencies (and optionally devDependencies) from
 * a parsed package.json object.
 */
export function getDeps(
  pkgJson: Record<string, unknown>,
  includeDevDeps = false,
): Array<string> {
  const deps = new Set<string>()
  const fields = includeDevDeps
    ? ['dependencies', 'devDependencies', 'peerDependencies']
    : ['dependencies', 'peerDependencies']
  for (const field of fields) {
    const d = pkgJson[field]
    if (d && typeof d === 'object') {
      for (const name of Object.keys(d as Record<string, string>)) {
        deps.add(name)
      }
    }
  }
  return [...deps]
}

/**
 * Resolve the directory of a dependency by name. First checks the top-level
 * node_modules (hoisted layout — npm, yarn, bun), then resolves through the
 * parent package's real path to handle pnpm's virtual store layout where
 * transitive deps are siblings in the .pnpm virtual store node_modules.
 */
export function resolveDepDir(
  depName: string,
  parentDir: string,
  parentName: string,
  nodeModulesDir: string,
): string | null {
  if (!parentName) return null

  // 1. Top-level (hoisted)
  const topLevel = join(nodeModulesDir, depName)
  if (existsSync(join(topLevel, 'package.json'))) return topLevel

  // 2. Resolve through parent's real path (pnpm virtual store)
  try {
    const realParent = realpathSync(parentDir)
    const segments = parentName.split('/').length
    let nmDir = realParent
    for (let i = 0; i < segments; i++) {
      nmDir = dirname(nmDir)
    }
    const nested = join(nmDir, depName)
    if (existsSync(join(nested, 'package.json'))) return nested
  } catch (err: unknown) {
    const code =
      err && typeof err === 'object' && 'code' in err
        ? (err as NodeJS.ErrnoException).code
        : undefined
    if (code !== 'ENOENT' && code !== 'ENOTDIR') {
      console.warn(
        `Warning: could not resolve ${depName} from ${parentDir}: ${err instanceof Error ? err.message : String(err)}`,
      )
    }
  }

  return null
}

/**
 * Parse YAML frontmatter from a file. Returns null if no frontmatter or on error.
 */
export function parseFrontmatter(
  filePath: string,
): Record<string, unknown> | null {
  let content: string
  try {
    content = readFileSync(filePath, 'utf8')
  } catch {
    return null
  }
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match?.[1]) return null
  try {
    return parseYaml(match[1]) as Record<string, unknown>
  } catch {
    return null
  }
}
