import { randomUUID } from 'node:crypto'
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, relative } from 'node:path'
import { projectPath } from './project.js'

export interface FileChange {
  path: string
  source: string | null
  content: string
}

export function writeChanges(root: string, changes: Array<FileChange>): void {
  for (const change of changes) {
    projectPath(root, relative(root, change.path).replaceAll('\\', '/'))
    const current = existsSync(change.path)
      ? readFileSync(change.path, 'utf8')
      : null
    if (current !== change.source)
      throw new Error(
        `File changed during maintainer operation: ${change.path}. Run the command again.`,
      )
  }
  for (const { path, source, content } of changes) {
    if (content === source) continue
    mkdirSync(dirname(path), { recursive: true })
    const temporary = `${path}.${randomUUID()}.tmp`
    try {
      writeFileSync(temporary, content, {
        flag: 'wx',
        mode: source === null ? 0o644 : statSync(path).mode,
      })
      renameSync(temporary, path)
    } finally {
      rmSync(temporary, { force: true })
    }
  }
}

export async function withMaintainerLock(
  root: string,
  action: () => void | Promise<void>,
): Promise<void> {
  const path = projectPath(root, '.intent/maintainer.lock')
  mkdirSync(dirname(path), { recursive: true })
  let fd: number
  try {
    fd = openSync(path, 'wx')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    throw new Error(
      'Another maintainer command holds .intent/maintainer.lock. Wait for it to finish; remove the lock only after confirming that process has stopped.',
    )
  }
  try {
    await action()
  } finally {
    closeSync(fd)
    rmSync(path)
  }
}
