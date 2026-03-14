import { execFileSync } from 'node:child_process'
import {
  existsSync,
  readFileSync,
  readdirSync,
  type Dirent,
} from 'node:fs'
import { createRequire } from 'node:module'
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

export function listNodeModulesPackageDirs(
  nodeModulesDir: string,
): Array<string> {
  if (!existsSync(nodeModulesDir)) return []

  let topEntries: Array<Dirent<string>>
  try {
    topEntries = readdirSync(nodeModulesDir, {
      withFileTypes: true,
      encoding: 'utf8',
    })
  } catch {
    return []
  }

  const packageDirs: Array<string> = []

  for (const entry of topEntries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    const dirPath = join(nodeModulesDir, entry.name)

    if (entry.name.startsWith('@')) {
      let scopedEntries: Array<Dirent<string>>
      try {
        scopedEntries = readdirSync(dirPath, {
          withFileTypes: true,
          encoding: 'utf8',
        })
      } catch {
        continue
      }

      for (const scoped of scopedEntries) {
        if (!scoped.isDirectory() && !scoped.isSymbolicLink()) continue
        packageDirs.push(join(dirPath, scoped.name))
      }
    } else if (!entry.name.startsWith('.')) {
      packageDirs.push(dirPath)
    }
  }

  return packageDirs
}

export function detectGlobalNodeModules(packageManager: string): {
  path: string | null
  source?: string
} {
  const envPath = process.env.INTENT_GLOBAL_NODE_MODULES?.trim()
  if (envPath) {
    return {
      path: envPath,
      source: 'INTENT_GLOBAL_NODE_MODULES',
    }
  }

  const commands: Array<{
    command: string
    args: Array<string>
    transform?: (output: string) => string
  }> = []

  if (packageManager === 'pnpm') {
    commands.push({ command: 'pnpm', args: ['root', '-g'] })
  }
  if (packageManager === 'yarn') {
    commands.push({
      command: 'yarn',
      args: ['global', 'dir'],
      transform: (output) => join(output, 'node_modules'),
    })
  }
  commands.push({ command: 'npm', args: ['root', '-g'] })

  for (const candidate of commands) {
    try {
      const output = execFileSync(candidate.command, candidate.args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim()
      if (!output) continue

      return {
        path: candidate.transform ? candidate.transform(output) : output,
        source: `${candidate.command} ${candidate.args.join(' ')}`,
      }
    } catch {
      continue
    }
  }

  return { path: null }
}

/**
 * Resolve the directory of a dependency by name. Uses Node's built-in
 * module resolution via createRequire, which handles:
 * - Hoisted layouts (npm, yarn, bun) — walks up directory tree
 * - pnpm symlinked virtual store — follows symlinks
 * - Workspace packages — finds deps at workspace root
 * - Nested node_modules — standard Node resolution
 */
export function resolveDepDir(
  depName: string,
  parentDir: string,
): string | null {
  try {
    const require = createRequire(join(parentDir, 'package.json'))
    const pkgJsonPath = require.resolve(join(depName, 'package.json'))
    return dirname(pkgJsonPath)
  } catch {
    return null
  }
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
