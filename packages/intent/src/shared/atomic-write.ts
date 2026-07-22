import {
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'

export function writeTextFileAtomic(path: string, content: string): void {
  const directory = dirname(path)
  mkdirSync(directory, { recursive: true })
  const temporaryPath = join(
    directory,
    `.${basename(path)}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`,
  )
  try {
    writeFileSync(temporaryPath, content, 'utf8')
    renameSync(temporaryPath, path)
  } finally {
    try {
      if (existsSync(temporaryPath)) unlinkSync(temporaryPath)
    } catch {}
  }
}
