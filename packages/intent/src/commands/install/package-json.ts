import { randomUUID } from 'node:crypto'
import {
  closeSync,
  fchmodSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { applyEdits, modify, parse, printParseErrorCode } from 'jsonc-parser'
import type { ParseError } from 'jsonc-parser'

export interface PreparedPackageSkillsUpdate {
  content: string
  packageJsonPath: string
  skills: Array<string>
  source: string
}

export interface PackageSkillsWriterRuntime {
  beforeReplace?: () => void
  rename?: (oldPath: string, newPath: string) => void
}

function parsePackageJson(
  content: string,
  packageJsonPath: string,
): Record<string, unknown> {
  const errors: Array<ParseError> = []
  const value = parse(content, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  }) as unknown

  if (errors.length > 0) {
    throw new Error(
      `Cannot update ${packageJsonPath}: invalid JSONC (${printParseErrorCode(errors[0]!.error)} at offset ${errors[0]!.offset}).`,
    )
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(
      `Cannot update ${packageJsonPath}: package.json must contain an object.`,
    )
  }

  const pkg = value as Record<string, unknown>
  if (
    pkg.intent !== undefined &&
    (pkg.intent === null ||
      typeof pkg.intent !== 'object' ||
      Array.isArray(pkg.intent))
  ) {
    throw new Error(
      `Cannot update ${packageJsonPath}: intent must contain an object.`,
    )
  }
  return pkg
}

function formattingOptions(content: string): {
  eol: string
  insertSpaces: boolean
  tabSize: number
} {
  const indentation = content.match(/(?:^|\r?\n)([ \t]+)"/)?.[1] ?? '  '
  return {
    eol: content.includes('\r\n') ? '\r\n' : '\n',
    insertSpaces: !indentation.includes('\t'),
    tabSize: indentation.includes('\t') ? 1 : indentation.length,
  }
}

export function preparePackageSkillsUpdate(
  packageJsonPath: string,
  skills: Array<string>,
): PreparedPackageSkillsUpdate {
  const source = readFileSync(packageJsonPath, 'utf8')
  parsePackageJson(source, packageJsonPath)
  const content = applyEdits(
    source,
    modify(source, ['intent', 'skills'], skills, {
      formattingOptions: formattingOptions(source),
    }),
  )
  const updated = parsePackageJson(content, packageJsonPath)
  const updatedIntent = updated.intent as Record<string, unknown>
  if (JSON.stringify(updatedIntent.skills) !== JSON.stringify(skills)) {
    throw new Error(
      `Cannot update ${packageJsonPath}: intent.skills validation failed.`,
    )
  }

  return { content, packageJsonPath, skills, source }
}

export function writePreparedPackageSkillsUpdate(
  update: PreparedPackageSkillsUpdate,
  runtime: PackageSkillsWriterRuntime = {},
): 'unchanged' | 'updated' {
  if (update.content === update.source) return 'unchanged'

  const targetDir = dirname(update.packageJsonPath)
  const temporaryPath = join(
    targetDir,
    `.${basename(update.packageJsonPath)}.${process.pid}.${randomUUID()}.tmp`,
  )
  const mode = statSync(update.packageJsonPath).mode
  let descriptor: number | null = null

  try {
    descriptor = openSync(temporaryPath, 'wx', mode)
    writeFileSync(descriptor, update.content, 'utf8')
    fchmodSync(descriptor, mode)
    fsyncSync(descriptor)
    closeSync(descriptor)
    descriptor = null

    runtime.beforeReplace?.()
    if (readFileSync(update.packageJsonPath, 'utf8') !== update.source) {
      throw new Error(
        `Cannot update ${update.packageJsonPath}: package.json changed after permission review. Run intent install again.`,
      )
    }

    ;(runtime.rename ?? renameSync)(temporaryPath, update.packageJsonPath)
    return 'updated'
  } finally {
    if (descriptor !== null) closeSync(descriptor)
    try {
      unlinkSync(temporaryPath)
    } catch {}
  }
}
