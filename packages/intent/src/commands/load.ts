import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fail } from '../cli-error.js'
import { scanOptionsFromGlobalFlags } from '../cli-support.js'
import { resolveSkillUse } from '../resolver.js'
import { parseSkillUse } from '../skill-use.js'
import { toPosixPath } from '../utils.js'
import type { GlobalScanFlags } from '../cli-support.js'
import type { ScanOptions, ScanResult } from '../types.js'

export interface LoadCommandOptions extends GlobalScanFlags {
  json?: boolean
  path?: boolean
}

function resolveFromCwd(path: string): string {
  return resolve(process.cwd(), path)
}

function isPathInsidePackageRoot(path: string, packageRoot: string): boolean {
  const relativePath = relative(
    resolveFromCwd(packageRoot),
    resolveFromCwd(path),
  )
  return (
    relativePath === '' ||
    (!relativePath.startsWith('..') && !isAbsolute(relativePath))
  )
}

function splitDestinationSuffix(destination: string): {
  pathPart: string
  suffix: string
} {
  const hashIndex = destination.indexOf('#')
  const queryIndex = destination.indexOf('?')
  const suffixIndex =
    hashIndex === -1
      ? queryIndex
      : queryIndex === -1
        ? hashIndex
        : Math.min(hashIndex, queryIndex)

  if (suffixIndex === -1) {
    return { pathPart: destination, suffix: '' }
  }

  return {
    pathPart: destination.slice(0, suffixIndex),
    suffix: destination.slice(suffixIndex),
  }
}

function isExternalOrAbsoluteDestination(destination: string): boolean {
  return (
    destination === '' ||
    destination.startsWith('#') ||
    destination.startsWith('?') ||
    destination.startsWith('//') ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(destination) ||
    isAbsolute(destination)
  )
}

interface MarkdownDestinationRewriteContext {
  cwd: string
  resolvedPackageRoot: string
  skillDir: string
}

function findClosingBracket(line: string, start: number): number {
  let depth = 0

  for (let index = start; index < line.length; index++) {
    const char = line[index]!
    if (char === '\\') {
      index++
      continue
    }
    if (char === '[') {
      depth++
      continue
    }
    if (char === ']') {
      depth--
      if (depth === 0) return index
    }
  }

  return -1
}

function findClosingParen(line: string, start: number): number {
  for (let index = start; index < line.length; index++) {
    const char = line[index]!
    if (char === '\\') {
      index++
      continue
    }
    if (char === ')') return index
  }

  return -1
}

function readBareDestination(
  line: string,
  start: number,
): { destinationEnd: number; endParen: number } | null {
  let depth = 0

  for (let index = start; index < line.length; index++) {
    const char = line[index]!
    if (char === '\\') {
      index++
      continue
    }
    if (char === '(') {
      depth++
      continue
    }
    if (char === ')') {
      if (depth === 0) {
        return { destinationEnd: index, endParen: index }
      }
      depth--
      continue
    }
    if (/\s/.test(char) && depth === 0) {
      const endParen = findClosingParen(line, index)
      if (endParen === -1) return null
      return { destinationEnd: index, endParen }
    }
  }

  return null
}

function readMarkdownDestination(
  line: string,
  start: number,
): {
  destination: string
  destinationStart: number
  destinationEnd: number
  endParen: number
} | null {
  let cursor = start
  while (cursor < line.length && /\s/.test(line[cursor]!)) cursor++

  if (line[cursor] === '<') {
    const destinationStart = cursor + 1
    const destinationEnd = line.indexOf('>', destinationStart)
    if (destinationEnd === -1) return null
    const endParen = findClosingParen(line, destinationEnd + 1)
    if (endParen === -1) return null
    return {
      destination: line.slice(destinationStart, destinationEnd),
      destinationStart,
      destinationEnd,
      endParen,
    }
  }

  const read = readBareDestination(line, cursor)
  if (!read) return null

  return {
    destination: line.slice(cursor, read.destinationEnd),
    destinationStart: cursor,
    destinationEnd: read.destinationEnd,
    endParen: read.endParen,
  }
}

function getCodeFenceMarker(line: string): '`' | '~' | null {
  const match = line.match(/^\s*(`{3,}|~{3,})/)
  const marker = match?.[1]?.[0]
  return marker === '`' || marker === '~' ? marker : null
}

function rewriteMarkdownDestination({
  context,
  destination,
}: {
  context: MarkdownDestinationRewriteContext
  destination: string
}): string {
  if (isExternalOrAbsoluteDestination(destination)) return destination

  const { pathPart, suffix } = splitDestinationSuffix(destination)
  if (isExternalOrAbsoluteDestination(pathPart)) return destination

  const resolvedDestinationPath = resolve(context.skillDir, pathPart)
  const relativeToPackageRoot = relative(
    context.resolvedPackageRoot,
    resolvedDestinationPath,
  )
  if (
    relativeToPackageRoot.startsWith('..') ||
    isAbsolute(relativeToPackageRoot)
  ) {
    return destination
  }

  const relativeToCwd = relative(context.cwd, resolvedDestinationPath)
  const rewrittenPath =
    relativeToCwd && !relativeToCwd.startsWith('..') && !isAbsolute(relativeToCwd)
      ? relativeToCwd
      : resolvedDestinationPath

  return `${toPosixPath(rewrittenPath)}${suffix}`
}

function rewriteMarkdownLineDestinations({
  context,
  line,
}: {
  context: MarkdownDestinationRewriteContext
  line: string
}): string {
  if (!line.includes('[')) return line

  let output = ''
  let cursor = 0

  while (cursor < line.length) {
    const nextCodeStart = line.indexOf('`', cursor)
    const nextLinkStart = line.indexOf('[', cursor)

    if (nextLinkStart === -1) {
      output += line.slice(cursor)
      break
    }

    if (nextCodeStart !== -1 && nextCodeStart < nextLinkStart) {
      output += line.slice(cursor, nextCodeStart)
      cursor = nextCodeStart
      const codeStart = cursor
      while (cursor < line.length && line[cursor] === '`') cursor++
      const marker = line.slice(codeStart, cursor)
      const codeEnd = line.indexOf(marker, cursor)
      if (codeEnd === -1) {
        output += line.slice(codeStart)
        break
      }
      output += line.slice(codeStart, codeEnd + marker.length)
      cursor = codeEnd + marker.length
      continue
    }

    const linkStart =
      nextLinkStart > 0 && line[nextLinkStart - 1] === '!'
        ? nextLinkStart - 1
        : nextLinkStart
    output += line.slice(cursor, linkStart)

    const labelStart = nextLinkStart
    const labelEnd = findClosingBracket(line, labelStart)
    if (labelEnd === -1) {
      output += line.slice(linkStart)
      break
    }

    if (line[labelEnd + 1] !== '(') {
      output += line.slice(linkStart, nextLinkStart + 1)
      cursor = nextLinkStart + 1
      continue
    }

    const destination = readMarkdownDestination(line, labelEnd + 2)
    if (!destination) {
      output += line.slice(linkStart, nextLinkStart + 1)
      cursor = nextLinkStart + 1
      continue
    }

    const rewritten = rewriteMarkdownDestination({
      context,
      destination: destination.destination,
    })
    output +=
      line.slice(linkStart, destination.destinationStart) +
      rewritten +
      line.slice(destination.destinationEnd, destination.endParen + 1)
    cursor = destination.endParen + 1
  }

  return output
}

function rewriteLoadedSkillMarkdownDestinations({
  content,
  packageRoot,
  skillFilePath,
}: {
  content: string
  packageRoot: string
  skillFilePath: string
}): string {
  const context: MarkdownDestinationRewriteContext = {
    cwd: process.cwd(),
    resolvedPackageRoot: resolveFromCwd(packageRoot),
    skillDir: dirname(skillFilePath),
  }
  let inFence: '`' | '~' | null = null
  const parts = content.split(/(\r?\n)/)
  let output = ''

  for (let index = 0; index < parts.length; index += 2) {
    const line = parts[index] ?? ''
    const newline = parts[index + 1] ?? ''
    const marker = getCodeFenceMarker(line)

    if (inFence) {
      output += line + newline
      if (marker === inFence) inFence = null
      continue
    }

    if (marker) {
      inFence = marker
      output += line + newline
      continue
    }

    output +=
      rewriteMarkdownLineDestinations({
        context,
        line,
      }) + newline
  }

  return output
}

export async function runLoadCommand(
  use: string | undefined,
  options: LoadCommandOptions,
  scanIntentsOrFail: (options?: ScanOptions) => Promise<ScanResult>,
): Promise<void> {
  if (!use) {
    fail('Missing skill use. Expected: intent load <package>#<skill>')
  }

  if (options.json && options.path) {
    fail('Use either --json or --path, not both.')
  }

  parseSkillUse(use)

  const result = await scanIntentsOrFail(scanOptionsFromGlobalFlags(options))
  const resolved = resolveSkillUse(use, result)
  const resolvedPath = resolveFromCwd(resolved.path)

  if (!isPathInsidePackageRoot(resolved.path, resolved.packageRoot)) {
    fail(
      `Resolved skill path for "${use}" is outside package root: ${resolved.path}`,
    )
  }

  if (!existsSync(resolvedPath)) {
    fail(`Resolved skill file was not found: ${resolved.path}`)
  }

  if (options.path) {
    console.log(resolved.path)
    for (const warning of resolved.warnings) {
      console.error(`Warning: ${warning}`)
    }
    return
  }

  const content = rewriteLoadedSkillMarkdownDestinations({
    content: readFileSync(resolvedPath, 'utf8'),
    packageRoot: resolved.packageRoot,
    skillFilePath: resolvedPath,
  })

  if (options.json) {
    console.log(
      JSON.stringify(
        {
          package: resolved.packageName,
          skill: resolved.skillName,
          path: resolved.path,
          packageRoot: resolved.packageRoot,
          source: resolved.source,
          version: resolved.version,
          content,
          warnings: resolved.warnings,
        },
        null,
        2,
      ),
    )
    return
  }

  process.stdout.write(content)

  for (const warning of resolved.warnings) {
    console.error(`Warning: ${warning}`)
  }
}
