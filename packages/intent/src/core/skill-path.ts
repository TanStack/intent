import { Buffer } from 'node:buffer'
import { isAbsolutePath } from '../skills/paths.js'

const CONTROL_OR_BIDI_PATTERN =
  /[\p{Cc}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u
const WINDOWS_DRIVE_PATTERN = /^[A-Za-z]:/

export function validateSkillPath(path: string): string {
  if (typeof path !== 'string' || path === '') {
    throw new Error('Skill path must be a non-empty string')
  }
  if (Buffer.byteLength(path, 'utf8') > 1024) {
    throw new Error('Skill path must be at most 1024 UTF-8 bytes')
  }
  if (CONTROL_OR_BIDI_PATTERN.test(path)) {
    throw new Error('Skill path must not contain control characters')
  }
  if (
    isAbsolutePath(path) ||
    WINDOWS_DRIVE_PATTERN.test(path) ||
    path.includes('\\')
  ) {
    throw new Error('Skill path must be a relative POSIX path')
  }

  const segments = path.split('/')
  if (segments.some((segment) => segment === '.' || segment === '..')) {
    throw new Error('Skill path must not contain . or .. segments')
  }
  if (segments.some((segment) => segment === '')) {
    throw new Error('Skill path must not contain empty segments')
  }

  return path
}

export function validateSkillPaths(
  paths: ReadonlyArray<string>,
): Array<string> {
  const seen = new Set<string>()

  return paths.map((path) => {
    const validatedPath = validateSkillPath(path)
    if (seen.has(validatedPath)) {
      throw new Error(`Duplicate skill path: ${validatedPath}`)
    }
    seen.add(validatedPath)
    return validatedPath
  })
}
