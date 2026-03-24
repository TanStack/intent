import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { basename, join, relative } from 'node:path'
import {
  findPackagesWithSkills,
  findWorkspaceRoot,
  readWorkspacePatterns,
} from './workspace-patterns.js'
import { resolveProjectContext } from './core/project-context.js'

export {
  findPackagesWithSkills,
  findWorkspaceRoot,
  readWorkspacePatterns,
  resolveWorkspacePackages,
} from './workspace-patterns.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

function isGenericWorkspaceName(name: string, root: string): boolean {
  const normalized = name.trim().toLowerCase()
  return (
    normalized.length === 0 ||
    normalized === 'unknown' ||
    normalized === 'root' ||
    normalized === 'workspace' ||
    normalized === 'monorepo' ||
    normalized === basename(root).toLowerCase()
  )
}

function deriveWorkspacePackageName(
  root: string,
  repo: string,
  packageDirs: Array<string>,
): string {
  const repoName = repo.split('/').filter(Boolean).pop() || basename(root)

  for (const packageDir of packageDirs) {
    const pkgJson = readPackageJson(packageDir)
    const pkgName = typeof pkgJson.name === 'string' ? pkgJson.name : null
    if (pkgName?.startsWith('@')) {
      const scope = pkgName.split('/')[0]
      return `${scope}/${repoName}`
    }
  }

  return repoName
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
  const rawName = typeof pkgJson.name === 'string' ? pkgJson.name : 'unknown'
  const docs =
    typeof (pkgJson.intent as Record<string, unknown> | undefined)?.docs ===
    'string'
      ? ((pkgJson.intent as Record<string, unknown>).docs as string)
      : 'docs/'
  const isMonorepo = packageDirs !== undefined
  const monorepoFallbackPkg = packageDirs?.[0]
    ? readPackageJson(packageDirs[0])
    : null
  const repo = detectRepo(
    pkgJson,
    detectRepo(monorepoFallbackPkg ?? {}, basename(root)),
  )

  let packageName = rawName
  if (isMonorepo && isGenericWorkspaceName(rawName, root)) {
    packageName = deriveWorkspacePackageName(root, repo, packageDirs)
  }

  // Derive srcPath: monorepos use a wildcard; single packages use the short name or fall back to root src/
  const shortName = packageName.replace(/^@[^/]+\//, '')
  let srcPath = isMonorepo
    ? 'packages/*/src/**'
    : `packages/${shortName}/src/**`
  if (!isMonorepo && existsSync(join(root, 'src'))) {
    srcPath = 'src/**'
  }

  const docsPath = isMonorepo ? 'packages/*/docs/**' : docs

  return {
    PACKAGE_NAME: packageName,
    PACKAGE_LABEL: packageName,
    PAYLOAD_PACKAGE: packageName,
    REPO: repo,
    DOCS_PATH: docsPath.endsWith('**')
      ? docsPath
      : docsPath.replace(/\/$/, '') + '/**',
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
// Command: edit-package-json
// ---------------------------------------------------------------------------

export function runEditPackageJson(root: string): EditPackageJsonResult {
  const result: EditPackageJsonResult = { added: [], alreadyPresent: [] }
  const context = resolveProjectContext({ cwd: root })
  const packageRoot = context.packageRoot ?? root
  const pkgPath = join(packageRoot, 'package.json')

  if (!existsSync(pkgPath)) {
    console.error('No package.json found in ' + packageRoot)
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
    process.exitCode = 1
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
  if (keywords.includes('tanstack-intent')) {
    result.alreadyPresent.push('keywords: "tanstack-intent"')
  } else {
    keywords.push('tanstack-intent')
    result.added.push('keywords: "tanstack-intent"')
  }

  // --- files array ---
  if (!Array.isArray(pkg.files)) {
    pkg.files = []
  }
  const files = pkg.files as Array<string>

  // In monorepos, _artifacts lives at repo root, not under packages —
  // the negation pattern is a no-op and shouldn't be added.
  const requiredFiles = context.isMonorepo
    ? ['skills']
    : ['skills', '!skills/_artifacts']

  for (const entry of requiredFiles) {
    if (files.includes(entry)) {
      result.alreadyPresent.push(`files: "${entry}"`)
    } else {
      files.push(entry)
      result.added.push(`files: "${entry}"`)
    }
  }

  writeFileSync(pkgPath, JSON.stringify(pkg, null, indentSize) + '\n')

  // Print results
  for (const a of result.added) console.log(`✓ Added ${a}`)
  for (const a of result.alreadyPresent) console.log(`  Already present: ${a}`)

  return result
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
