import { spawnSync } from 'node:child_process'

const GIT_MAX_BUFFER = 10 * 1024 * 1024

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

function parseChangedPaths(output: string): Array<string> {
  if (!output) return []

  const fields = output.split('\0')
  if (fields.pop() !== '' || fields.some((path) => path.length === 0)) {
    throw new Error('git diff returned malformed name-only output.')
  }

  return [...new Set(fields)].sort(compareStrings)
}

export function collectChangedPathsSince(
  repositoryRoot: string,
  since: string,
): Array<string> {
  const baseline = since.trim()
  if (!baseline) {
    throw new Error('A non-empty Git baseline ref is required.')
  }

  const result = spawnSync(
    'git',
    [
      '-c',
      'core.fsmonitor=false',
      'diff',
      '--name-only',
      '-z',
      '--no-renames',
      '--end-of-options',
      `${baseline}...HEAD`,
      '--',
    ],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
      maxBuffer: GIT_MAX_BUFFER,
    },
  )

  if (result.error) {
    throw new Error(`Git change detection could not run: ${result.error.message}`)
  }
  if (result.status !== 0) {
    const detail = result.stderr.trim()
    if (
      detail.includes('not a git repository') ||
      detail.includes('Could not access')
    ) {
      throw new Error(
        `Cannot determine source changes: ${repositoryRoot} is not a Git repository.`,
      )
    }
    if (
      detail.includes('unknown revision') ||
      detail.includes('bad revision') ||
      detail.includes('ambiguous argument') ||
      detail.includes('no merge base')
    ) {
      throw new Error(
        `Git baseline "${baseline}" is unavailable. Fetch that ref or deepen the clone, then retry.`,
      )
    }
    throw new Error(
      `Git change detection failed: ${detail || `exit code ${String(result.status)}`}`,
    )
  }

  return parseChangedPaths(result.stdout)
}
