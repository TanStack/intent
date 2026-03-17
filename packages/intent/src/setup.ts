import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { basename, join, relative } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { findSkillFiles, normalizeRepoUrl, readPkgJsonFile } from './utils.js'

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
  WORKSPACE_SKILL_GLOBS: string
}

interface MonorepoTemplateContext {
  packageDirsWithSkills: Array<string>
  workspacePatterns: Array<string>
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
    const pkgJson = readPkgJsonFile(packageDir)
    const pkgName = typeof pkgJson?.name === 'string' ? pkgJson.name : null
    if (pkgName?.startsWith('@')) {
      const scope = pkgName.split('/')[0]
      return `${scope}/${repoName}`
    }
  }

  return repo || basename(root)
}

// ---------------------------------------------------------------------------
// Variable detection from package.json
// ---------------------------------------------------------------------------

function detectRepo(
  pkgJson: Record<string, unknown>,
  fallback: string,
): string {
  const intent = pkgJson.intent as Record<string, unknown> | undefined
  if (typeof intent?.repo === 'string') {
    return intent.repo
  }

  if (typeof pkgJson.repository === 'string') {
    return normalizeRepoUrl(pkgJson.repository)
  }

  if (
    pkgJson.repository &&
    typeof pkgJson.repository === 'object' &&
    typeof (pkgJson.repository as Record<string, unknown>).url === 'string'
  ) {
    return normalizeRepoUrl(
      (pkgJson.repository as Record<string, unknown>).url as string,
    )
  }

  return fallback
}

function isEnoent(err: unknown): boolean {
  return (
    !!err &&
    typeof err === 'object' &&
    'code' in err &&
    (err as NodeJS.ErrnoException).code === 'ENOENT'
  )
}

function normalizePattern(pattern: string): string {
  return pattern.endsWith('**') ? pattern : pattern.replace(/\/$/, '') + '/**'
}

function normalizeWorkspacePattern(pattern: string): string {
  return pattern.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '')
}

function normalizeWorkspacePatterns(
  patterns: Array<string> | null | undefined,
): Array<string> {
  if (!patterns) return []

  return [
    ...new Set(patterns.map(normalizeWorkspacePattern).filter(Boolean)),
  ].sort()
}

function sanitizeJsonc(content: string): string {
  let result = ''
  let inString = false
  let escaped = false

  for (let i = 0; i < content.length; i++) {
    const char = content[i]!
    const next = content[i + 1]

    if (inString) {
      result += char
      if (escaped) {
        escaped = false
      } else if (char === '\\') {
        escaped = true
      } else if (char === '"') {
        inString = false
      }
      continue
    }

    if (char === '"') {
      inString = true
      result += char
      continue
    }

    // Strip // line comments
    if (char === '/' && next === '/') {
      while (i < content.length && content[i] !== '\n') i++
      if (i < content.length) result += '\n'
      continue
    }

    // Strip /* block comments */
    if (char === '/' && next === '*') {
      i += 2
      while (
        i < content.length &&
        !(content[i] === '*' && content[i + 1] === '/')
      ) {
        i++
      }
      i++
      continue
    }

    // Strip trailing commas before ] or }
    if (char === ',') {
      let j = i + 1
      while (j < content.length && /\s/.test(content[j]!)) j++
      if (content[j] === ']' || content[j] === '}') {
        continue
      }
    }

    result += char
  }

  return result
}

function readJsoncFile(path: string): Record<string, unknown> | null {
  try {
    const raw = readFileSync(path, 'utf8')
    return JSON.parse(sanitizeJsonc(raw)) as Record<string, unknown>
  } catch (err: unknown) {
    if (!isEnoent(err)) {
      console.error(
        `Warning: failed to parse ${path}: ${err instanceof Error ? err.message : err}`,
      )
    }
    return null
  }
}

function buildFallbackWorkspacePaths(
  patterns: Array<string>,
  suffixes: Array<string>,
): Array<string> {
  const paths = new Set<string>()

  for (const pattern of patterns) {
    if (pattern.startsWith('!')) continue
    const normalized = normalizeWorkspacePattern(pattern)
    for (const suffix of suffixes) {
      paths.add(`${normalized}/${suffix}`)
    }
  }

  return [...paths].sort()
}

function buildWorkspaceSkillGlobs(patterns: Array<string>): string {
  const globs = buildFallbackWorkspacePaths(patterns, ['skills'])
  return globs.length > 0 ? globs.join(' ') : '__intent_no_workspace_skills__'
}

function buildWatchPaths(
  root: string,
  packageDirs: Array<string>,
  workspacePatterns: Array<string>,
): string {
  const paths = new Set<string>()
  let hasPackageSpecificPaths = false

  if (existsSync(join(root, 'docs'))) {
    paths.add('docs/**')
  }

  for (const packageDir of packageDirs) {
    const relDir = relative(root, packageDir).split('\\').join('/')
    if (existsSync(join(packageDir, 'src'))) {
      paths.add(`${relDir}/src/**`)
      hasPackageSpecificPaths = true
    }

    const pkgJson = readPkgJsonFile(packageDir) || {}
    const intent = pkgJson.intent as Record<string, unknown> | undefined
    const docs = typeof intent?.docs === 'string' ? intent.docs : 'docs/'
    if (!docs.startsWith('http://') && !docs.startsWith('https://')) {
      paths.add(normalizePattern(join(relDir, docs).split('\\').join('/')))
      hasPackageSpecificPaths = true
    }
  }

  if (!hasPackageSpecificPaths) {
    for (const path of buildFallbackWorkspacePaths(workspacePatterns, [
      'src/**',
      'docs/**',
    ])) {
      paths.add(path)
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

function detectVars(
  root: string,
  context?: MonorepoTemplateContext,
): TemplateVars {
  const pkgJson = readPkgJsonFile(root) || {}
  const rawName = typeof pkgJson.name === 'string' ? pkgJson.name : 'unknown'
  const docs =
    typeof (pkgJson.intent as Record<string, unknown> | undefined)?.docs ===
    'string'
      ? ((pkgJson.intent as Record<string, unknown>).docs as string)
      : 'docs/'
  const workspacePatterns = context?.workspacePatterns ?? []
  const isMonorepo = workspacePatterns.length > 0
  const packageDirs = context?.packageDirsWithSkills ?? []

  const monorepoFallbackPkg = packageDirs[0]
    ? (readPkgJsonFile(packageDirs[0]) ?? {})
    : {}
  const repo = detectRepo(
    pkgJson,
    detectRepo(monorepoFallbackPkg, basename(root)),
  )

  let packageName = rawName
  if (isMonorepo && isGenericWorkspaceName(rawName, root)) {
    packageName = deriveWorkspacePackageName(root, repo, packageDirs)
  }

  const shortName = packageName.replace(/^@[^/]+\//, '')
  let srcPath: string
  if (isMonorepo) {
    srcPath =
      buildFallbackWorkspacePaths(workspacePatterns, ['src/**'])[0] ??
      'packages/*/src/**'
  } else if (existsSync(join(root, 'src'))) {
    srcPath = 'src/**'
  } else {
    srcPath = `packages/${shortName}/src/**`
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
      ? buildWatchPaths(root, packageDirs, workspacePatterns)
      : `      - '${docs.endsWith('**') ? docs : docs.replace(/\/$/, '') + '/**'}'\n      - '${srcPath}'`,
    WORKSPACE_SKILL_GLOBS: buildWorkspaceSkillGlobs(
      isMonorepo ? workspacePatterns : [],
    ),
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
    .replace(/\{\{WORKSPACE_SKILL_GLOBS\}\}/g, vars.WORKSPACE_SKILL_GLOBS)
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
        `\n${vars.WATCH_PATHS}`,
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
  const isMonorepo = findWorkspaceRoot(join(root, '..')) !== null
  const requiredFiles = isMonorepo
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
// Monorepo workspace resolution
// ---------------------------------------------------------------------------

export function readWorkspacePatterns(root: string): Array<string> | null {
  // pnpm-workspace.yaml
  try {
    const raw = readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')
    const config = parseYaml(raw) as Record<string, unknown>
    if (Array.isArray(config.packages)) {
      return normalizeWorkspacePatterns(config.packages as Array<string>)
    }
  } catch (err: unknown) {
    if (!isEnoent(err)) {
      console.error(
        `Warning: failed to parse pnpm-workspace.yaml: ${err instanceof Error ? err.message : err}`,
      )
    }
  }

  // package.json workspaces (npm, yarn, bun)
  try {
    const pkg = JSON.parse(
      readFileSync(join(root, 'package.json'), 'utf8'),
    ) as Record<string, unknown>
    const ws = pkg.workspaces
    if (Array.isArray(ws)) {
      return normalizeWorkspacePatterns(ws as Array<string>)
    }
    if (
      ws &&
      typeof ws === 'object' &&
      Array.isArray((ws as Record<string, unknown>).packages)
    ) {
      return normalizeWorkspacePatterns(
        (ws as Record<string, unknown>).packages as Array<string>,
      )
    }
  } catch (err: unknown) {
    if (!isEnoent(err)) {
      console.error(
        `Warning: failed to parse package.json: ${err instanceof Error ? err.message : err}`,
      )
    }
  }

  // deno.json / deno.jsonc
  for (const name of ['deno.json', 'deno.jsonc']) {
    const config = readJsoncFile(join(root, name))
    if (config && Array.isArray(config.workspace)) {
      return normalizeWorkspacePatterns(config.workspace as Array<string>)
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
  const include = patterns.filter((p) => !p.startsWith('!'))
  const exclude = patterns
    .filter((p) => p.startsWith('!'))
    .map((p) => p.slice(1))

  const dirs: Array<string> = []
  for (const pattern of include) {
    const segments = pattern.split('/')
    for (const resolved of resolveGlob(root, segments)) {
      if (existsSync(join(resolved, 'package.json'))) {
        dirs.push(resolved)
      }
    }
  }

  if (exclude.length === 0) return dirs

  const excludedDirs = new Set<string>()
  for (const pattern of exclude) {
    const segments = pattern.split('/')
    for (const resolved of resolveGlob(root, segments)) {
      excludedDirs.add(resolved)
    }
  }

  return dirs.filter((dir) => !excludedDirs.has(dir))
}

function resolveGlob(base: string, segments: Array<string>): Array<string> {
  if (segments.length === 0) return [base]

  const [head, ...rest] = segments

  if (head === '*') {
    return listChildDirs(base).flatMap((dir) => resolveGlob(dir, rest))
  }

  if (head === '**') {
    const results = resolveGlob(base, rest)
    for (const dir of listChildDirs(base)) {
      results.push(...resolveGlob(dir, segments))
    }
    return results
  }

  const next = join(base, head!)
  return existsSync(next) ? resolveGlob(next, rest) : []
}

function listChildDirs(dir: string): Array<string> {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(
        (e) =>
          e.isDirectory() &&
          e.name !== 'node_modules' &&
          !e.name.startsWith('.'),
      )
      .map((e) => join(dir, e.name))
  } catch {
    return []
  }
}

export function findWorkspaceRoot(start: string): string | null {
  let dir = start

  for (;;) {
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
  const patterns = readWorkspacePatterns(root)
  const isMonorepo = patterns !== null
  const pkgsWithSkills = isMonorepo
    ? resolveWorkspacePackages(root, patterns).filter((dir) => {
        const skillsDir = join(dir, 'skills')
        return existsSync(skillsDir) && findSkillFiles(skillsDir).length > 0
      })
    : []

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
  const workspacePatterns = readWorkspacePatterns(workspaceRoot)
  const isMonorepo = workspacePatterns !== null
  const packageDirs = isMonorepo ? findPackagesWithSkills(workspaceRoot) : []
  const vars = detectVars(workspaceRoot, {
    packageDirsWithSkills: packageDirs,
    workspacePatterns: workspacePatterns ?? [],
  })
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
      `  Mode:     ${isMonorepo ? `monorepo (${packageDirs.length} packages with skills)` : 'single package'}`,
    )
  }

  return result
}
