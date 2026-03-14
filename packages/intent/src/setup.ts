import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { basename, join, relative } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { findSkillFiles } from './utils.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AddLibraryBinResult {
  shim: string | null
  skipped: string | null
}

export interface EditPackageJsonResult {
  added: Array<string>
  alreadyPresent: Array<string>
}

export interface SetupGithubActionsResult {
  workflows: Array<string>
  skipped: Array<string>
}

export interface MonorepoResult<T> {
  package: string
  result: T
}

interface TemplateVars {
  PACKAGE_NAME: string
  PACKAGE_LABEL: string
  PAYLOAD_PACKAGE: string
  REPO: string
  DOCS_PATH: string
  SRC_PATH: string
  WATCH_PATHS: string
}

// ---------------------------------------------------------------------------
// Variable detection from package.json
// ---------------------------------------------------------------------------

function readPackageJson(root: string): Record<string, unknown> {
  const pkgPath = join(root, 'package.json')
  try {
    return JSON.parse(readFileSync(pkgPath, 'utf8')) as Record<string, unknown>
  } catch (err: unknown) {
    const isNotFound =
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as NodeJS.ErrnoException).code === 'ENOENT'
    if (!isNotFound) {
      console.error(
        `Warning: could not read ${pkgPath}: ${err instanceof Error ? err.message : err}`,
      )
    }
    return {}
  }
}

function detectRepo(
  pkgJson: Record<string, unknown>,
  fallback: string,
): string {
  const intent = pkgJson.intent as Record<string, unknown> | undefined
  if (typeof intent?.repo === 'string') {
    return intent.repo
  }

  if (typeof pkgJson.repository === 'string') {
    return pkgJson.repository
      .replace(/^git\+/, '')
      .replace(/\.git$/, '')
      .replace(/^https?:\/\/github\.com\//, '')
  }

  if (
    pkgJson.repository &&
    typeof pkgJson.repository === 'object' &&
    typeof (pkgJson.repository as Record<string, unknown>).url === 'string'
  ) {
    return ((pkgJson.repository as Record<string, unknown>).url as string)
      .replace(/^git\+/, '')
      .replace(/\.git$/, '')
      .replace(/^https?:\/\/github\.com\//, '')
  }

  return fallback
}

function normalizePattern(pattern: string): string {
  return pattern.endsWith('**') ? pattern : pattern.replace(/\/$/, '') + '/**'
}

function buildWatchPaths(root: string, packageDirs: Array<string>): string {
  const paths = new Set<string>()

  if (existsSync(join(root, 'docs'))) {
    paths.add('docs/**')
  }

  for (const packageDir of packageDirs) {
    const relDir = relative(root, packageDir).split('\\').join('/')
    if (existsSync(join(packageDir, 'src'))) {
      paths.add(`${relDir}/src/**`)
    }

    const pkgJson = readPackageJson(packageDir)
    const intent = pkgJson.intent as Record<string, unknown> | undefined
    const docs = typeof intent?.docs === 'string' ? intent.docs : 'docs/'
    if (!docs.startsWith('http://') && !docs.startsWith('https://')) {
      paths.add(normalizePattern(join(relDir, docs).split('\\').join('/')))
    }
  }

  if (paths.size === 0) {
    paths.add('packages/*/src/**')
    paths.add('packages/*/docs/**')
  }

  return [...paths]
    .sort()
    .map((path) => `      - '${path}'`)
    .join('\n')
}

function detectVars(root: string, packageDirs?: Array<string>): TemplateVars {
  const pkgJson = readPackageJson(root)
  const name = typeof pkgJson.name === 'string' ? pkgJson.name : 'unknown'
  const docs =
    typeof (pkgJson.intent as Record<string, unknown> | undefined)?.docs ===
    'string'
      ? ((pkgJson.intent as Record<string, unknown>).docs as string)
      : 'docs/'
  const repo = detectRepo(pkgJson, name.replace(/^@/, '').replace(/\//, '/'))
  const isMonorepo = packageDirs !== undefined
  const packageLabel =
    isMonorepo && name === 'unknown' ? `${basename(root)} workspace` : name

  // Best-guess src path from common monorepo patterns
  const shortName = name.replace(/^@[^/]+\//, '')
  let srcPath = `packages/${shortName}/src/**`
  if (existsSync(join(root, 'src'))) {
    srcPath = 'src/**'
  }

  return {
    PACKAGE_NAME: name,
    PACKAGE_LABEL: packageLabel,
    PAYLOAD_PACKAGE: packageLabel,
    REPO: repo,
    DOCS_PATH: docs.endsWith('**') ? docs : docs.replace(/\/$/, '') + '/**',
    SRC_PATH: srcPath,
    WATCH_PATHS: isMonorepo
      ? buildWatchPaths(root, packageDirs)
      : `      - '${docs.endsWith('**') ? docs : docs.replace(/\/$/, '') + '/**'}'\n      - '${srcPath}'`,
  }
}

// ---------------------------------------------------------------------------
// Template variable substitution
// ---------------------------------------------------------------------------

function applyVars(content: string, vars: TemplateVars): string {
  return content
    .replace(/\{\{PACKAGE_NAME\}\}/g, vars.PACKAGE_NAME)
    .replace(/\{\{PACKAGE_LABEL\}\}/g, vars.PACKAGE_LABEL)
    .replace(/\{\{PAYLOAD_PACKAGE\}\}/g, vars.PAYLOAD_PACKAGE)
    .replace(/\{\{REPO\}\}/g, vars.REPO)
    .replace(/\{\{DOCS_PATH\}\}/g, vars.DOCS_PATH)
    .replace(/\{\{SRC_PATH\}\}/g, vars.SRC_PATH)
    .replace(/\{\{WATCH_PATHS\}\}/g, vars.WATCH_PATHS)
}

// ---------------------------------------------------------------------------
// Copy helpers
// ---------------------------------------------------------------------------

function copyTemplates(
  srcDir: string,
  destDir: string,
  vars: TemplateVars,
): { copied: Array<string>; skipped: Array<string> } {
  const copied: Array<string> = []
  const skipped: Array<string> = []

  if (!existsSync(srcDir)) return { copied, skipped }

  mkdirSync(destDir, { recursive: true })

  for (const entry of readdirSync(srcDir)) {
    const srcPath = join(srcDir, entry)
    const destPath = join(destDir, entry)

    if (existsSync(destPath)) {
      skipped.push(destPath)
      continue
    }

    let content = readFileSync(srcPath, 'utf8')
    if (vars.WATCH_PATHS.includes('\n')) {
      content = content.replace(
        /\s+- '?\{\{DOCS_PATH\}\}'?\n\s+- '?\{\{SRC_PATH\}\}'?/,
        vars.WATCH_PATHS,
      )
    }
    const substituted = applyVars(content, vars)
    writeFileSync(destPath, substituted)
    copied.push(destPath)
  }

  return { copied, skipped }
}

// ---------------------------------------------------------------------------
// Shim generation helpers
// ---------------------------------------------------------------------------

function getShimContent(ext: string): string {
  return `#!/usr/bin/env node
// Auto-generated by @tanstack/intent setup
// Exposes the intent end-user CLI for consumers of this library.
// Commit this file, then add to your package.json:
//   "bin": { "intent": "./bin/intent.${ext}" }
try {
  await import('@tanstack/intent/intent-library')
} catch (e) {
  if (e?.code === 'ERR_MODULE_NOT_FOUND' || e?.code === 'MODULE_NOT_FOUND') {
    console.error('@tanstack/intent is not installed.')
    console.error('')
    console.error('Install it as a dev dependency:')
    console.error('  npm add -D @tanstack/intent')
    console.error('')
    console.error('Or run directly:')
    console.error('  npx @tanstack/intent@latest list')
    process.exit(1)
  }
  throw e
}
`
}

function detectShimExtension(root: string): string {
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    if (pkg.type === 'module') return 'js'
  } catch (err: unknown) {
    const isNotFound =
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as NodeJS.ErrnoException).code === 'ENOENT'
    if (!isNotFound) {
      console.error(
        `Warning: could not read package.json: ${err instanceof Error ? err.message : err}`,
      )
    }
  }
  return 'mjs'
}

function findExistingShim(root: string): string | null {
  const shimJs = join(root, 'bin', 'intent.js')
  if (existsSync(shimJs)) return shimJs

  const shimMjs = join(root, 'bin', 'intent.mjs')
  if (existsSync(shimMjs)) return shimMjs

  return null
}

// ---------------------------------------------------------------------------
// Command: add-library-bin
// ---------------------------------------------------------------------------

export function runAddLibraryBin(root: string): AddLibraryBinResult {
  const result: AddLibraryBinResult = { shim: null, skipped: null }

  const existingShim = findExistingShim(root)
  if (existingShim) {
    result.skipped = existingShim
    console.log(`  Already exists: ${existingShim}`)
    return result
  }

  const ext = detectShimExtension(root)
  const shimPath = join(root, 'bin', `intent.${ext}`)
  mkdirSync(join(root, 'bin'), { recursive: true })
  writeFileSync(shimPath, getShimContent(ext))
  result.shim = shimPath

  console.log(`✓ Generated intent shim: ${shimPath}`)
  console.log(
    `\n  Run \`npx @tanstack/intent edit-package-json\` to wire package.json.`,
  )

  return result
}

// ---------------------------------------------------------------------------
// Command: edit-package-json
// ---------------------------------------------------------------------------

export function runEditPackageJson(root: string): EditPackageJsonResult {
  const result: EditPackageJsonResult = { added: [], alreadyPresent: [] }
  const pkgPath = join(root, 'package.json')

  if (!existsSync(pkgPath)) {
    console.error('No package.json found in ' + root)
    process.exitCode = 1
    return result
  }

  const raw = readFileSync(pkgPath, 'utf8')
  let pkg: Record<string, unknown>
  try {
    pkg = JSON.parse(raw) as Record<string, unknown>
  } catch (err) {
    const detail = err instanceof SyntaxError ? err.message : String(err)
    console.error(`Failed to parse ${pkgPath}: ${detail}`)
    return result
  }

  // Detect indent size from existing file
  const indentMatch = raw.match(/^(\s+)"/m)
  const indentSize = indentMatch?.[1] ? indentMatch[1].length : 2

  // --- keywords array ---
  if (!Array.isArray(pkg.keywords)) {
    pkg.keywords = []
  }
  const keywords = pkg.keywords as Array<string>
  const requiredKeywords = ['tanstack-intent']
  for (const kw of requiredKeywords) {
    if (keywords.includes(kw)) {
      result.alreadyPresent.push(`keywords: "${kw}"`)
    } else {
      keywords.push(kw)
      result.added.push(`keywords: "${kw}"`)
    }
  }

  // --- files array ---
  if (!Array.isArray(pkg.files)) {
    pkg.files = []
  }
  const files = pkg.files as Array<string>

  // In monorepos, _artifacts lives at repo root, not under packages —
  // the negation pattern is a no-op and shouldn't be added.
  // Detect monorepo by walking up to find a parent package.json with workspaces.
  const isMonorepo = (() => {
    let dir = join(root, '..')
    for (let i = 0; i < 5; i++) {
      const parentPkg = join(dir, 'package.json')
      if (existsSync(parentPkg)) {
        try {
          const parent = JSON.parse(readFileSync(parentPkg, 'utf8'))
          if (Array.isArray(parent.workspaces) || parent.workspaces?.packages) {
            return true
          }
        } catch {}
        return false
      }
      const next = join(dir, '..')
      if (next === dir) break
      dir = next
    }
    return false
  })()
  const requiredFiles = isMonorepo
    ? ['skills', 'bin']
    : ['skills', 'bin', '!skills/_artifacts']

  for (const entry of requiredFiles) {
    if (files.includes(entry)) {
      result.alreadyPresent.push(`files: "${entry}"`)
    } else {
      files.push(entry)
      result.added.push(`files: "${entry}"`)
    }
  }

  // --- bin field ---
  const existingShim = findExistingShim(root)
  let ext: string
  if (existingShim) {
    ext = existingShim.endsWith('.mjs') ? 'mjs' : 'js'
  } else {
    ext = pkg.type === 'module' ? 'js' : 'mjs'
  }
  const shimRelative = `./bin/intent.${ext}`

  if (typeof pkg.bin === 'object' && pkg.bin !== null) {
    const binObj = pkg.bin as Record<string, string>
    if (binObj.intent) {
      result.alreadyPresent.push(`bin.intent`)
    } else {
      binObj.intent = shimRelative
      result.added.push(`bin.intent: "${shimRelative}"`)
    }
  } else if (!pkg.bin) {
    pkg.bin = { intent: shimRelative }
    result.added.push(`bin.intent: "${shimRelative}"`)
  } else if (typeof pkg.bin === 'string') {
    // npm string shorthand: "bin": "./cli.js" means { "<name>": "./cli.js" }
    const pkgName =
      typeof pkg.name === 'string'
        ? pkg.name.replace(/^@[^/]+\//, '')
        : 'unknown'
    pkg.bin = { [pkgName]: pkg.bin, intent: shimRelative }
    result.added.push(
      `bin.intent: "${shimRelative}" (converted bin from string to object)`,
    )
  }

  writeFileSync(pkgPath, JSON.stringify(pkg, null, indentSize) + '\n')

  // Print results
  for (const a of result.added) console.log(`✓ Added ${a}`)
  for (const a of result.alreadyPresent) console.log(`  Already present: ${a}`)

  return result
}

// ---------------------------------------------------------------------------
// Monorepo workspace resolution
// ---------------------------------------------------------------------------

export function readWorkspacePatterns(root: string): Array<string> | null {
  // pnpm-workspace.yaml
  const pnpmWs = join(root, 'pnpm-workspace.yaml')
  if (existsSync(pnpmWs)) {
    try {
      const config = parseYaml(readFileSync(pnpmWs, 'utf8')) as Record<
        string,
        unknown
      >
      if (Array.isArray(config.packages)) {
        return config.packages as Array<string>
      }
    } catch (err: unknown) {
      console.error(
        `Warning: failed to parse ${pnpmWs}: ${err instanceof Error ? err.message : err}`,
      )
    }
  }

  // package.json workspaces
  const pkgPath = join(root, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
      if (Array.isArray(pkg.workspaces)) {
        return pkg.workspaces
      }
      if (Array.isArray(pkg.workspaces?.packages)) {
        return pkg.workspaces.packages
      }
    } catch (err: unknown) {
      console.error(
        `Warning: failed to parse ${pkgPath}: ${err instanceof Error ? err.message : err}`,
      )
    }
  }

  return null
}

/**
 * Resolve workspace glob patterns to actual package directories.
 * Handles simple patterns like "packages/*" and "packages/**".
 * Each resolved directory must contain a package.json.
 */
export function resolveWorkspacePackages(
  root: string,
  patterns: Array<string>,
): Array<string> {
  const dirs: Array<string> = []

  for (const pattern of patterns) {
    // Strip trailing /* or /**/* for directory resolution
    const base = pattern.replace(/\/\*\*?(\/\*)?$/, '')
    const baseDir = join(root, base)
    if (!existsSync(baseDir)) continue

    if (pattern.includes('**')) {
      // Recursive: walk all subdirectories
      collectPackageDirs(baseDir, dirs)
    } else if (pattern.endsWith('/*')) {
      // Single level: direct children
      for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue
        const dir = join(baseDir, entry.name)
        if (existsSync(join(dir, 'package.json'))) {
          dirs.push(dir)
        }
      }
    } else {
      // Exact path
      const dir = join(root, pattern)
      if (existsSync(join(dir, 'package.json'))) {
        dirs.push(dir)
      }
    }
  }

  return dirs
}

function collectPackageDirs(dir: string, result: Array<string>): void {
  if (existsSync(join(dir, 'package.json'))) {
    result.push(dir)
  }
  let entries: Array<import('node:fs').Dirent>
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch (err: unknown) {
    console.error(
      `Warning: could not read directory ${dir}: ${err instanceof Error ? err.message : err}`,
    )
    return
  }
  for (const entry of entries) {
    if (
      !entry.isDirectory() ||
      entry.name === 'node_modules' ||
      entry.name.startsWith('.')
    )
      continue
    collectPackageDirs(join(dir, entry.name), result)
  }
}

export function findWorkspaceRoot(start: string): string | null {
  let dir = start

  while (true) {
    if (readWorkspacePatterns(dir)) {
      return dir
    }

    const next = join(dir, '..')
    if (next === dir) return null
    dir = next
  }
}

/**
 * Find workspace packages that contain at least one SKILL.md file.
 */
export function findPackagesWithSkills(root: string): Array<string> {
  const patterns = readWorkspacePatterns(root)
  if (!patterns) return []

  return resolveWorkspacePackages(root, patterns).filter((dir) => {
    const skillsDir = join(dir, 'skills')
    return existsSync(skillsDir) && findSkillFiles(skillsDir).length > 0
  })
}

// ---------------------------------------------------------------------------
// Monorepo-aware command runner
// ---------------------------------------------------------------------------

/**
 * When run from a monorepo root, finds all workspace packages with SKILL.md
 * files and runs the given command on each. Falls back to single-package
 * behavior only when no workspace config is detected. If workspace config
 * exists but no packages have skills, warns and returns empty.
 */
function runForEachPackage<T>(
  root: string,
  runOne: (dir: string) => T,
): Array<MonorepoResult<T>> | T {
  const isMonorepo = readWorkspacePatterns(root) !== null
  const pkgsWithSkills = isMonorepo ? findPackagesWithSkills(root) : []

  if (!isMonorepo) {
    return runOne(root)
  }

  if (pkgsWithSkills.length === 0) {
    console.log('No workspace packages with skills found.')
    return []
  }

  return pkgsWithSkills.map((pkgDir) => {
    const rel = relative(root, pkgDir) || '.'
    console.log(`\n── ${rel} ──`)
    return { package: rel, result: runOne(pkgDir) }
  })
}

export function runEditPackageJsonAll(
  root: string,
): Array<MonorepoResult<EditPackageJsonResult>> | EditPackageJsonResult {
  return runForEachPackage(root, runEditPackageJson)
}

export function runAddLibraryBinAll(
  root: string,
): Array<MonorepoResult<AddLibraryBinResult>> | AddLibraryBinResult {
  return runForEachPackage(root, runAddLibraryBin)
}

// ---------------------------------------------------------------------------
// Command: setup-github-actions
// ---------------------------------------------------------------------------

export function runSetupGithubActions(
  root: string,
  metaDir: string,
): SetupGithubActionsResult {
  const workspaceRoot = findWorkspaceRoot(root) ?? root
  const packageDirs = findPackagesWithSkills(workspaceRoot)
  const vars = detectVars(
    workspaceRoot,
    packageDirs.length > 0 ? packageDirs : undefined,
  )
  const result: SetupGithubActionsResult = { workflows: [], skipped: [] }

  const srcDir = join(metaDir, 'templates', 'workflows')
  const destDir = join(workspaceRoot, '.github', 'workflows')
  const { copied, skipped } = copyTemplates(srcDir, destDir, vars)
  result.workflows = copied
  result.skipped = skipped

  for (const f of result.workflows) console.log(`✓ Copied workflow: ${f}`)
  for (const f of result.skipped) console.log(`  Already exists: ${f}`)

  if (result.workflows.length === 0 && result.skipped.length === 0) {
    console.log('No templates directory found. Is @tanstack/intent installed?')
  } else if (result.workflows.length > 0) {
    console.log(`\nTemplate variables applied:`)
    console.log(`  Package:  ${vars.PACKAGE_LABEL}`)
    console.log(`  Repo:     ${vars.REPO}`)
    console.log(
      `  Mode:     ${packageDirs.length > 0 ? `monorepo (${packageDirs.length} packages with skills)` : 'single package'}`,
    )
  }

  return result
}
