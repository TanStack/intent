import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { repositoryWritePath } from './write-path.js'
import type { FileChange } from '../maintainer/files.js'

// Let Git encode paths, hunk ranges, and newline markers. The temporary index
// contains only supplied snapshots; user/repository filters and hooks cannot run.
export function renderRepairPatch(
  root: string,
  changes: Array<FileChange & { source: string }>,
): string {
  if (!changes.length) return ''
  const temporary = mkdtempSync(join(tmpdir(), 'intent-repair-patch-'))
  const git = (args: Array<string>, diff = false) => {
    const result = spawnSync(
      'git',
      [
        '-c',
        'core.fsmonitor=false',
        '-c',
        'core.autocrlf=false',
        '-c',
        'core.attributesFile=/dev/null',
        ...args,
      ],
      {
        cwd: temporary,
        env: {
          PATH: process.env.PATH,
          SystemRoot: process.env.SystemRoot,
          GIT_CONFIG_NOSYSTEM: '1',
          GIT_CONFIG_GLOBAL: '/dev/null',
          GIT_ATTR_NOSYSTEM: '1',
          GIT_CONFIG_COUNT: '0',
        },
        encoding: 'utf8',
        timeout: 10_000,
        maxBuffer: 16 * 1024 * 1024,
      },
    )
    if (result.error || (result.status !== 0 && !(diff && result.status === 1)))
      throw new Error(
        `Cannot create repair patch: ${result.error?.message ?? result.stderr}`,
      )
    return result.stdout
  }
  try {
    const paths = changes.map((change) =>
      relative(root, repositoryWritePath(root, change.path)),
    )
    git(['-c', 'init.templateDir=', 'init', '-q'])
    for (const [index, change] of changes.entries()) {
      const path = join(temporary, paths[index]!)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, change.source)
    }
    git(['add', '--', '.'])
    for (const [index, change] of changes.entries())
      writeFileSync(join(temporary, paths[index]!), change.content)
    return git(
      ['diff', '--no-ext-diff', '--no-textconv', '--binary', '--exit-code'],
      true,
    )
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}
