function assertCanonicalPackageRelativePath(path: string): void {
  if (typeof path !== 'string' || path === '') {
    throw new Error('Skill path must be a non-empty string.')
  }
  if (
    path.includes('\0') ||
    path.includes('\\') ||
    path.startsWith('/') ||
    /^[a-zA-Z]:/.test(path) ||
    path.startsWith('//')
  ) {
    throw new Error(`Invalid skill path: ${path}`)
  }
  if (
    path
      .split('/')
      .some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error(`Invalid skill path: ${path}`)
  }
}

export function validateSkillPaths(
  paths: ReadonlyArray<string>,
): Array<string> {
  const seen = new Set<string>()
  for (const path of paths) {
    assertCanonicalPackageRelativePath(path)
    if (seen.has(path)) {
      throw new Error(`Duplicate skill path: ${path}`)
    }
    seen.add(path)
  }
  return [...paths]
}

export function validateSkillPath(path: string): string {
  return validateSkillPaths([path])[0]!
}
