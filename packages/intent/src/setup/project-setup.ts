import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join, relative } from 'node:path'
import { repositoryWritePath } from '../shared/write-path.js'
import { errorMessage, isRecord } from '../shared/utils.js'
import { writeChanges } from '../maintainer/files.js'
import { resolveProjectContext } from '../core/project-context.js'
import { createIntentFsCache } from '../discovery/fs-cache.js'
import {
  findPackagesWithSkills,
  findWorkspaceRoot,
  readWorkspacePatterns,
} from './workspace-patterns.js'
import type { FileChange } from '../maintainer/files.js'
import type { IntentFsCache } from '../discovery/fs-cache.js'

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
  INTENT_WORKFLOW_REF: string
  INTENT_ARTIFACTS: string
}

// The pin belongs to the installed artifact. Never resolve a mutable release
// tag at setup time or silently weaken the pin when offline.
export function resolveIntentWorkflowRef(packageDir: string): string {
  const version = readPackageJson(packageDir).version
  try {
    const metadata = JSON.parse(
      readFileSync(join(packageDir, 'dist/workflow-ref.json'), 'utf8'),
    )
    if (
      metadata.version === version &&
      typeof metadata.commit === 'string' &&
      /^[0-9a-f]{40}$/.test(metadata.commit)
    )
      return validateWorkflowRef(`${metadata.commit} # v${version}`)
  } catch {
    // Report one actionable error for absent, invalid, or mismatched metadata.
  }
  throw new Error(
    'No immutable workflow reference is packaged for this Intent version. Install a release build, or set INTENT_WORKFLOW_REF to a verified full commit SHA for development.',
  )
}

function validateWorkflowRef(ref: string): string {
  if (!/^[0-9a-f]{40}(?: # v[0-9][A-Za-z0-9.+-]*)?$/.test(ref))
    throw new Error(
      'INTENT_WORKFLOW_REF must be a full 40-character commit SHA, optionally followed by a release version comment.',
    )
  return ref
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

function readPackageJson(root: string): Record<string, unknown> {
  const pkgPath = join(root, 'package.json')
  try {
    const parsed: unknown = JSON.parse(readFileSync(pkgPath, 'utf8'))
    return isRecord(parsed) ? parsed : {}
  } catch (err: unknown) {
    const isNotFound =
      err &&
      typeof err === 'object' &&
      'code' in err &&
      (err as NodeJS.ErrnoException).code === 'ENOENT'
    if (!isNotFound) {
      console.error(`Warning: could not read ${pkgPath}: ${errorMessage(err)}`)
    }
    return {}
  }
}

function detectRepo(
  pkgJson: Record<string, unknown>,
  fallback: string,
): string {
  const intent = isRecord(pkgJson.intent) ? pkgJson.intent : undefined
  if (typeof intent?.repo === 'string') {
    return intent.repo
  }

  const { repository } = pkgJson
  const url = isRecord(repository) ? repository.url : repository
  if (typeof url === 'string') {
    return url
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

    const { intent } = readPackageJson(packageDir)
    const docs =
      isRecord(intent) && typeof intent.docs === 'string'
        ? intent.docs
        : 'docs/'
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
  const intent = isRecord(pkgJson.intent) ? pkgJson.intent : undefined
  const docs = typeof intent?.docs === 'string' ? intent.docs : 'docs/'
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
    INTENT_WORKFLOW_REF: '',
    INTENT_ARTIFACTS: '',
  }
}

function applyTemplate(content: string, vars: TemplateVars): string {
  if (vars.WATCH_PATHS) {
    content = content.replace(
      /\s+- '?\{\{DOCS_PATH\}\}'?\n\s+- '?\{\{SRC_PATH\}\}'?/,
      vars.WATCH_PATHS,
    )
  }
  return content
    .replace(/\{\{PACKAGE_NAME\}\}/g, vars.PACKAGE_NAME)
    .replace(/\{\{PACKAGE_LABEL\}\}/g, vars.PACKAGE_LABEL)
    .replace(/\{\{PAYLOAD_PACKAGE\}\}/g, vars.PAYLOAD_PACKAGE)
    .replace(/\{\{REPO\}\}/g, vars.REPO)
    .replace(/\{\{DOCS_PATH\}\}/g, vars.DOCS_PATH)
    .replace(/\{\{SRC_PATH\}\}/g, vars.SRC_PATH)
    .replace(/\{\{WATCH_PATHS\}\}/g, vars.WATCH_PATHS)
    .replace(/\{\{INTENT_WORKFLOW_REF\}\}/g, vars.INTENT_WORKFLOW_REF)
    .replace(/\{\{INTENT_ARTIFACTS\}\}/g, vars.INTENT_ARTIFACTS)
}

export function runEditPackageJson(root: string): EditPackageJsonResult {
  return editPackageJson(root, createIntentFsCache())
}

function editPackageJson(
  root: string,
  fsCache: IntentFsCache,
): EditPackageJsonResult {
  const result: EditPackageJsonResult = { added: [], alreadyPresent: [] }
  const context = resolveProjectContext({ cwd: root, fsCache })
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

  const indentMatch = raw.match(/^(\s+)"/m)
  const indentSize = indentMatch?.[1] ? indentMatch[1].length : 2

  const keywords: Array<unknown> = Array.isArray(pkg.keywords)
    ? pkg.keywords
    : []
  pkg.keywords = keywords
  if (keywords.includes('tanstack-intent')) {
    result.alreadyPresent.push('keywords: "tanstack-intent"')
  } else {
    keywords.push('tanstack-intent')
    result.added.push('keywords: "tanstack-intent"')
  }

  const files: Array<unknown> = Array.isArray(pkg.files) ? pkg.files : []
  pkg.files = files

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

  for (const a of result.added) console.log(`✓ Added ${a}`)
  for (const a of result.alreadyPresent) console.log(`  Already present: ${a}`)

  return result
}

export function runEditPackageJsonAll(
  root: string,
): Array<MonorepoResult<EditPackageJsonResult>> | EditPackageJsonResult {
  const fsCache = createIntentFsCache()
  if (readWorkspacePatterns(root, fsCache) === null) {
    return editPackageJson(root, fsCache)
  }

  const pkgsWithSkills = findPackagesWithSkills(root, fsCache)
  if (pkgsWithSkills.length === 0) {
    console.log('No workspace packages with skills found.')
    return []
  }

  return pkgsWithSkills.map((pkgDir) => {
    const rel = relative(root, pkgDir) || '.'
    console.log(`\n── ${rel} ──`)
    return { package: rel, result: editPackageJson(pkgDir, fsCache) }
  })
}

export function planSetupGithubActions(
  root: string,
  metaDir: string,
  artifacts = '',
) {
  const fsCache = createIntentFsCache()
  const workspaceRoot = findWorkspaceRoot(root, fsCache) ?? root
  const packageDirs = findPackagesWithSkills(workspaceRoot, fsCache)
  const vars = detectVars(
    workspaceRoot,
    packageDirs.length > 0 ? packageDirs : undefined,
  )
  // This label enters a YAML scalar and a GitHub Actions input. Package or
  // repository metadata must not introduce YAML or Actions expressions.
  if (!/^[A-Za-z0-9@._ /-]+$/.test(vars.PACKAGE_LABEL))
    throw new Error('Cannot generate a workflow with an unsafe package label.')
  if (artifacts && !/^[A-Za-z0-9@._ /-]+$/.test(artifacts))
    throw new Error(
      'Cannot generate a workflow with an unsafe planning directory.',
    )
  vars.INTENT_ARTIFACTS = artifacts
  const srcDir = join(metaDir, 'templates', 'workflows')
  const destDir = join(workspaceRoot, '.github', 'workflows')
  const skipped: Array<string> = []
  const templates: Array<{ path: string; content: string }> = []
  for (const entry of existsSync(srcDir) ? readdirSync(srcDir) : []) {
    const path = repositoryWritePath(workspaceRoot, join(destDir, entry))
    if (existsSync(path)) skipped.push(path)
    else
      templates.push({
        path,
        content: readFileSync(join(srcDir, entry), 'utf8'),
      })
  }
  // Existing workflows are preserved even in a development build with no pin.
  if (
    templates.some(({ content }) => content.includes('{{INTENT_WORKFLOW_REF}}'))
  )
    vars.INTENT_WORKFLOW_REF =
      (process.env.INTENT_WORKFLOW_REF
        ? validateWorkflowRef(process.env.INTENT_WORKFLOW_REF)
        : undefined) || resolveIntentWorkflowRef(join(metaDir, '..'))
  const changes: Array<FileChange> = templates.map(({ path, content }) => ({
    path,
    source: null,
    content: applyTemplate(content, vars),
  }))
  const workflows = changes.map((change) => change.path)
  const messages = [
    ...workflows.map((file) => `✓ Copied workflow: ${file}`),
    ...skipped.map((file) => `  Already exists: ${file}`),
  ]
  if (workflows.length === 0 && skipped.length === 0) {
    messages.push(
      'No templates directory found. Is @tanstack/intent installed?',
    )
  } else if (workflows.length > 0) {
    messages.push(
      `\nTemplate variables applied:`,
      `  Package:  ${vars.PACKAGE_LABEL}`,
      `  Repo:     ${vars.REPO}`,
    )
    if (vars.INTENT_WORKFLOW_REF)
      messages.push(`  Workflow: TanStack/intent@${vars.INTENT_WORKFLOW_REF}`)
    messages.push(
      `  Mode:     ${packageDirs.length > 0 ? `monorepo (${packageDirs.length} packages with skills)` : 'single package'}`,
    )
  }

  return { root: workspaceRoot, changes, workflows, skipped, messages }
}

export function runSetupGithubActions(
  root: string,
  metaDir: string,
): SetupGithubActionsResult {
  const plan = planSetupGithubActions(root, metaDir)
  writeChanges(plan.root, plan.changes)
  for (const message of plan.messages) console.log(message)
  return { workflows: plan.workflows, skipped: plan.skipped }
}
