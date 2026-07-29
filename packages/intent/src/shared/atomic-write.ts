import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'

export function writeTextFileAtomic(path: string, content: string): void {
  const directory = dirname(path)
  mkdirSync(directory, { recursive: true })
  const temporaryPath = join(
    directory,
    `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`,
  )
  const mode = existsSync(path) ? statSync(path).mode & 0o777 : undefined
  try {
    writeFileSync(temporaryPath, content, {
      encoding: 'utf8',
      flag: 'wx',
      ...(mode === undefined ? {} : { mode }),
    })
    if (mode !== undefined) chmodSync(temporaryPath, mode)
    renameSync(temporaryPath, path)
  } finally {
    try {
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath)
    } catch {}
  }
}
