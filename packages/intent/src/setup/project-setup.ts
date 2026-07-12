import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { basename, dirname, join, relative } from 'node:path'
import { resolveProjectContext } from '../core/project-context.js'
import {
  findPackagesWithSkills,
  findWorkspaceRoot,
  readWorkspacePatterns,
} from './workspace-patterns.js'

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

export interface EditPackageJsonPlan extends EditPackageJsonResult {
  packageJsonPath: string
  content: string
}

export interface SetupGithubActionsResult {
  workflows: Array<string>
  skipped: Array<string>
}

export type SetupWorkflowStatus = 'conflict' | 'current' | 'missing' | 'stale'

export interface SetupWorkflowPlan {
  workflowPath: string
  content: string
  issue?: 'template-missing'
  status: SetupWorkflowStatus
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

const workflowHashPlaceholder = '{{WORKFLOW_CONTENT_SHA256}}'
const workflowHashPattern =
  /^(# intent-workflow-content-sha256: )([a-f0-9]{64})$/m

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

function isRemoteUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://')
}

function localDocsPattern(value: string): string | null {
  return isRemoteUrl(value) ? null : normalizePattern(value)
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
    const docsPattern = localDocsPattern(docs)
    if (docsPattern) {
      paths.add(
        normalizePattern(join(relDir, docsPattern).split('\\').join('/')),
      )
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

  const docsPath = isMonorepo ? 'packages/*/docs/**' : localDocsPattern(docs)
  const watchPaths = isMonorepo
    ? buildWatchPaths(root, packageDirs)
    : [docsPath, srcPath]
        .filter((path): path is string => Boolean(path))
        .map((path) => `      - '${path}'`)
        .join('\n')

  return {
    PACKAGE_NAME: packageName,
    PACKAGE_LABEL: packageName,
    PAYLOAD_PACKAGE: packageName,
    REPO: repo,
    DOCS_PATH: docsPath ?? 'docs/**',
    SRC_PATH: srcPath,
    WATCH_PATHS: watchPaths,
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

function stampManagedWorkflow(content: string): string {
  if (!content.includes(workflowHashPlaceholder)) return content
  const hash = createHash('sha256').update(content).digest('hex')
  return content.replace(workflowHashPlaceholder, hash)
}

function isUnmodifiedManagedWorkflow(content: string): boolean {
  if (!content.includes('# intent-workflow-managed: true')) return false
  const match = content.match(workflowHashPattern)
  const declaredHash = match?.[2]
  if (!declaredHash) return false
  const normalized = content.replace(
    workflowHashPattern,
    `$1${workflowHashPlaceholder}`,
  )
  return createHash('sha256').update(normalized).digest('hex') === declaredHash
}

function renderTemplate(content: string, vars: TemplateVars): string {
  let rendered = content
  if (vars.WATCH_PATHS) {
    rendered = rendered.replace(
      /\s+- '?\{\{DOCS_PATH\}\}'?\n\s+- '?\{\{SRC_PATH\}\}'?/,
      vars.WATCH_PATHS,
    )
  }
  return stampManagedWorkflow(applyVars(rendered, vars))
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

    const content = readFileSync(srcPath, 'utf8')
    const substituted = renderTemplate(content, vars)
    writeFileSync(destPath, substituted)
    copied.push(destPath)
  }

  return { copied, skipped }
}

export function planSetupWorkflow(
  root: string,
  metaDir: string,
): SetupWorkflowPlan {
  const workspaceRoot = findWorkspaceRoot(root) ?? root
  const packageDirs = findPackagesWithSkills(workspaceRoot)
  const vars = detectVars(
    workspaceRoot,
    packageDirs.length > 0 ? packageDirs : undefined,
  )
  const templatePath = join(
    metaDir,
    'templates',
    'workflows',
    'check-skills.yml',
  )
  const workflowPath = join(
    workspaceRoot,
    '.github',
    'workflows',
    'check-skills.yml',
  )
  if (!existsSync(templatePath)) {
    return {
      workflowPath,
      content: '',
      issue: 'template-missing',
      status: 'conflict',
    }
  }

  const content = renderTemplate(readFileSync(templatePath, 'utf8'), vars)
  if (!existsSync(workflowPath)) {
    return { workflowPath, content, status: 'missing' }
  }

  const existing = readFileSync(workflowPath, 'utf8')
  if (existing === content) {
    return { workflowPath, content, status: 'current' }
  }
  return {
    workflowPath,
    content,
    status: isUnmodifiedManagedWorkflow(existing) ? 'stale' : 'conflict',
  }
}

export function writeSetupWorkflowPlan(plan: SetupWorkflowPlan): void {
  mkdirSync(dirname(plan.workflowPath), { recursive: true })
  writeFileSync(plan.workflowPath, plan.content)
}

// ---------------------------------------------------------------------------
// Command: edit-package-json
// ---------------------------------------------------------------------------

export function planEditPackageJson(root: string): EditPackageJsonPlan | null {
  const result: EditPackageJsonResult = { added: [], alreadyPresent: [] }
  const context = resolveProjectContext({ cwd: root })
  const packageRoot = context.packageRoot ?? root
  const pkgPath = join(packageRoot, 'package.json')

  if (!existsSync(pkgPath)) {
    console.error('No package.json found in ' + packageRoot)
    return null
  }

  const raw = readFileSync(pkgPath, 'utf8')
  let pkg: Record<string, unknown>
  try {
    pkg = JSON.parse(raw) as Record<string, unknown>
  } catch (err) {
    const detail = err instanceof SyntaxError ? err.message : String(err)
    console.error(`Failed to parse ${pkgPath}: ${detail}`)
    return null
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

  return {
    ...result,
    packageJsonPath: pkgPath,
    content: JSON.stringify(pkg, null, indentSize) + '\n',
  }
}

export function writeEditPackageJsonPlan(plan: EditPackageJsonPlan): void {
  writeFileSync(plan.packageJsonPath, plan.content)
}

export function runEditPackageJson(root: string): EditPackageJsonResult {
  const plan = planEditPackageJson(root)
  if (!plan) {
    process.exitCode = 1
    return { added: [], alreadyPresent: [] }
  }

  writeEditPackageJsonPlan(plan)

  // Print results
  for (const a of plan.added) console.log(`✓ Added ${a}`)
  for (const a of plan.alreadyPresent) console.log(`  Already present: ${a}`)

  return { added: plan.added, alreadyPresent: plan.alreadyPresent }
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

export function planEditPackageJsonAll(
  root: string,
):
  | Array<MonorepoResult<EditPackageJsonPlan | null>>
  | EditPackageJsonPlan
  | null {
  return runForEachPackage(root, planEditPackageJson)
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
