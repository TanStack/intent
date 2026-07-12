import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { readSkillFolderContents } from '../../core/lockfile/hash.js'

interface NpmPackFile {
  path: string
}

export interface ReleasePackageError {
  file: string
  message: string
}

function isNpmPackFile(value: unknown): value is NpmPackFile {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Record<string, unknown>).path === 'string'
  )
}

function readPackedPaths(packageRoot: string): Set<string> {
  const result = spawnSync(
    'npm',
    ['pack', '--dry-run', '--json', '--ignore-scripts'],
    {
      cwd: packageRoot,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    },
  )

  if (result.error) {
    throw new Error(`npm pack could not run: ${result.error.message}`)
  }
  if (result.status !== 0) {
    const detail = result.stderr.trim() || `exit code ${String(result.status)}`
    throw new Error(`npm pack failed: ${detail}`)
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(result.stdout)
  } catch {
    throw new Error('npm pack returned malformed JSON output.')
  }
  const inventory =
    Array.isArray(parsed) &&
    parsed.length === 1 &&
    typeof parsed[0] === 'object' &&
    parsed[0] !== null
      ? (parsed[0] as Record<string, unknown>)
      : null
  const files = inventory?.files
  if (!Array.isArray(files) || !files.every(isNpmPackFile)) {
    throw new Error('npm pack returned an unsupported JSON inventory shape.')
  }

  return new Set(files.map((file) => file.path))
}

export function collectReleasePackageErrors({
  packageRoot,
  skillFiles,
}: {
  packageRoot: string
  skillFiles: Array<string>
}): Array<ReleasePackageError> {
  let packageJson: unknown
  try {
    packageJson = JSON.parse(
      readFileSync(join(packageRoot, 'package.json'), 'utf8'),
    )
  } catch (error) {
    return [
      {
        file: 'package.json',
        message: `release validation requires valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      },
    ]
  }
  if (
    typeof packageJson !== 'object' ||
    packageJson === null ||
    typeof (packageJson as Record<string, unknown>).name !== 'string' ||
    typeof (packageJson as Record<string, unknown>).version !== 'string'
  ) {
    return [
      {
        file: 'package.json',
        message: 'release validation requires string name and version fields',
      },
    ]
  }

  let packedPaths: Set<string>
  try {
    packedPaths = readPackedPaths(packageRoot)
  } catch (error) {
    return [
      {
        file: 'package.json',
        message: `${error instanceof Error ? error.message : String(error)} Release validation requires npm pack inventory output.`,
      },
    ]
  }

  const requiredPaths = new Set(['package.json', 'skills/intent.manifest.json'])
  for (const skillFile of skillFiles) {
    const skillDir = dirname(skillFile)
    const skillBase = relative(packageRoot, skillFile)
      .split('\\')
      .join('/')
      .replace(/\/SKILL\.md$/, '')
    for (const entry of readSkillFolderContents(skillDir, packageRoot)) {
      requiredPaths.add(
        join(skillBase, entry.relativePath).split('\\').join('/'),
      )
    }
  }

  const errors: Array<ReleasePackageError> = []
  for (const path of [...requiredPaths].sort()) {
    if (!packedPaths.has(path)) {
      errors.push({
        file: path,
        message:
          'missing from the npm package; update package.json "files" or ignore rules so this reviewed skill file is published',
      })
    }
  }
  for (const path of [...packedPaths].sort()) {
    if (path === '_artifacts' || path.includes('/_artifacts/')) {
      errors.push({
        file: path,
        message:
          'review artifact would be published; exclude skills/_artifacts (or the corresponding package artifact path)',
      })
    }
  }

  return errors
}
