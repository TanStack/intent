import { isAbsolute, relative, resolve, win32 } from 'node:path'

export function assertCanonicalPackageRelativePath(
  path: string,
  label: string,
): void {
  if (path.length === 0) {
    throw new Error(`Invalid ${label}: path must not be empty.`)
  }
  if (isAbsolute(path) || win32.isAbsolute(path)) {
    throw new Error(
      `Invalid ${label}: path must be package-relative (must be relative), got "${path}".`,
    )
  }
  if (path.includes('\\')) {
    throw new Error(
      `Invalid ${label}: path must use "/" separators, got "${path}".`,
    )
  }
  if (path.includes('\0')) {
    throw new Error(`Invalid ${label}: path must not contain a NUL byte.`)
  }
  if (
    path
      .split('/')
      .some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(
      `Invalid ${label}: path must be package-relative without empty, "." or ".." segments, got "${path}".`,
    )
  }
}

export function assertCanonicalPackageRelativePaths(
  paths: ReadonlyArray<string>,
  label: string,
): void {
  const seen = new Set<string>()
  for (const path of paths) {
    assertCanonicalPackageRelativePath(path, label)
    if (seen.has(path)) {
      throw new Error(`Invalid ${label}: duplicate path "${path}".`)
    }
    seen.add(path)
  }
}

export function resolveCanonicalPackagePath(
  packageRoot: string,
  path: string,
  label: string,
): string {
  assertCanonicalPackageRelativePath(path, label)
  const resolvedPath = resolve(packageRoot, path)
  const packageRelativePath = relative(packageRoot, resolvedPath)
  if (packageRelativePath.startsWith('..') || isAbsolute(packageRelativePath)) {
    throw new Error(
      `Invalid ${label}: path escapes the package root, got "${path}".`,
    )
  }
  return resolvedPath
}
