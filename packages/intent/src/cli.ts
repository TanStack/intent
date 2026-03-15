#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { INSTALL_PROMPT } from './install-prompt.js'
import type { ScanResult } from './types.js'

function getMetaDir(): string {
  const thisDir = dirname(fileURLToPath(import.meta.url))
  return join(thisDir, '..', 'meta')
}

type CliFailure = {
  message: string
  exitCode: number
}

function fail(message: string, exitCode = 1): never {
  throw { message, exitCode } satisfies CliFailure
}

function isCliFailure(value: unknown): value is CliFailure {
  return (
    !!value &&
    typeof value === 'object' &&
    'message' in value &&
    typeof value.message === 'string' &&
    'exitCode' in value &&
    typeof value.exitCode === 'number'
  )
}

async function scanIntentsOrFail(): Promise<ScanResult> {
  const { scanForIntents } = await import('./scanner.js')

  try {
    return scanForIntents()
  } catch (err) {
    fail((err as Error).message)
  }
}

function printWarnings(warnings: Array<string>): void {
  if (warnings.length === 0) return

  console.log('Warnings:')
  for (const warning of warnings) {
    console.log(`  ⚠ ${warning}`)
  }
}

function formatScanCoverage(result: ScanResult): string {
  const coverage: Array<string> = []

  if (result.nodeModules.local.scanned) coverage.push('project node_modules')
  if (result.nodeModules.global.scanned) coverage.push('global node_modules')

  return coverage.join(', ')
}

function printVersionConflicts(result: ScanResult): void {
  if (result.conflicts.length === 0) return

  console.log('\nVersion conflicts:\n')
  for (const conflict of result.conflicts) {
    console.log(`  ${conflict.packageName} -> using ${conflict.chosen.version}`)
    console.log(`    chosen: ${conflict.chosen.packageRoot}`)

    for (const variant of conflict.variants) {
      if (variant.packageRoot === conflict.chosen.packageRoot) continue
      console.log(
        `    also found: ${variant.version} at ${variant.packageRoot}`,
      )
    }

    console.log()
  }
}

function buildValidationFailure(
  errors: Array<{ file: string; message: string }>,
  warnings: Array<string>,
): string {
  const lines = ['', `❌ Validation failed with ${errors.length} error(s):`, '']

  for (const { file, message } of errors) {
    lines.push(`  ${file}: ${message}`)
  }

  if (warnings.length > 0) {
    lines.push('', '⚠ Packaging warnings:')
    for (const warning of warnings) {
      lines.push(`  ${warning}`)
    }
  }

  return lines.join('\n')
}

async function cmdList(args: Array<string>): Promise<void> {
  const { computeSkillNameWidth, printSkillTree, printTable } =
    await import('./display.js')
  const jsonOutput = args.includes('--json')
  const result = await scanIntentsOrFail()

  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2))
    return
  }

  const scanCoverage = formatScanCoverage(result)

  if (result.packages.length === 0) {
    console.log('No intent-enabled packages found.')
    if (scanCoverage) console.log(`Scanned: ${scanCoverage}`)
    if (result.warnings.length > 0) {
      console.log()
      printWarnings(result.warnings)
    }
    return
  }

  const totalSkills = result.packages.reduce(
    (sum, p) => sum + p.skills.length,
    0,
  )
  console.log(
    `\n${result.packages.length} intent-enabled packages, ${totalSkills} skills (${result.packageManager})\n`,
  )
  if (scanCoverage) {
    console.log(
      `Scanned: ${scanCoverage}${result.nodeModules.global.scanned ? ' (local packages take precedence)' : ''}\n`,
    )
  }

  // Summary table
  const rows = result.packages.map((pkg) => [
    pkg.name,
    pkg.version,
    String(pkg.skills.length),
    pkg.intent.requires?.join(', ') || '–',
  ])
  printTable(['PACKAGE', 'VERSION', 'SKILLS', 'REQUIRES'], rows)

  printVersionConflicts(result)

  // Skills detail
  const allSkills = result.packages.map((p) => p.skills)
  const nameWidth = computeSkillNameWidth(allSkills)
  const showTypes = result.packages.some((p) => p.skills.some((s) => s.type))

  console.log(`\nSkills:\n`)
  for (const pkg of result.packages) {
    console.log(`  ${pkg.name}`)
    printSkillTree(pkg.skills, { nameWidth, showTypes })
    console.log()
  }

  console.log(`Feedback:`)
  console.log(
    `  Submit feedback on skill usage to help maintainers improve the skills.`,
  )
  console.log(
    `  Load: node_modules/@tanstack/intent/meta/feedback-collection/SKILL.md`,
  )
  console.log()

  printWarnings(result.warnings)
}

async function cmdMeta(args: Array<string>): Promise<void> {
  const { parseFrontmatter } = await import('./utils.js')
  const metaDir = getMetaDir()

  if (!existsSync(metaDir)) {
    fail('Meta-skills directory not found.')
  }

  if (args.length > 0) {
    const name = args[0]!
    if (name.includes('..') || name.includes('/') || name.includes('\\')) {
      fail(`Invalid meta-skill name: "${name}"`)
    }
    const skillFile = join(metaDir, name, 'SKILL.md')
    if (!existsSync(skillFile)) {
      fail(
        `Meta-skill "${name}" not found. Run \`intent meta\` to list available meta-skills.`,
      )
    }
    try {
      console.log(readFileSync(skillFile, 'utf8'))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      fail(`Failed to read meta-skill "${name}": ${msg}`)
    }
    return
  }

  const entries = readdirSync(metaDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .filter((e) => existsSync(join(metaDir, e.name, 'SKILL.md')))

  if (entries.length === 0) {
    console.log('No meta-skills found.')
    return
  }

  console.log('Meta-skills (for library maintainers):\n')

  for (const entry of entries) {
    const skillFile = join(metaDir, entry.name, 'SKILL.md')
    const fm = parseFrontmatter(skillFile)
    let description = ''
    if (typeof fm?.description === 'string') {
      description = fm.description.replace(/\s+/g, ' ').trim()
    }

    const shortDesc =
      description.length > 60 ? description.slice(0, 57) + '...' : description
    console.log(`  ${entry.name.padEnd(28)} ${shortDesc}`)
  }

  console.log(`\nUsage: load the SKILL.md into your AI agent conversation.`)
  console.log(`Path: node_modules/@tanstack/intent/meta/<name>/SKILL.md`)
}

function collectPackagingWarnings(root: string): Array<string> {
  const pkgJsonPath = join(root, 'package.json')
  if (!existsSync(pkgJsonPath)) return []

  let pkgJson: Record<string, unknown>
  try {
    pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return [`Could not parse package.json: ${msg}`]
  }

  const warnings: Array<string> = []

  const devDeps = pkgJson.devDependencies as Record<string, string> | undefined
  if (!devDeps?.['@tanstack/intent']) {
    warnings.push('@tanstack/intent is not in devDependencies')
  }

  const keywords = pkgJson.keywords
  if (!Array.isArray(keywords) || !keywords.includes('tanstack-intent')) {
    warnings.push('Missing "tanstack-intent" in keywords array')
  }

  const files = pkgJson.files as Array<string> | undefined
  if (Array.isArray(files)) {
    if (!files.includes('skills')) {
      warnings.push(
        '"skills" is not in the "files" array — skills won\'t be published',
      )
    }

    // Only warn about !skills/_artifacts for non-monorepo packages.
    // In monorepos, artifacts live at the repo root, so the negation
    // pattern is intentionally omitted by edit-package-json.
    const isMonorepoPkg = (() => {
      let dir = join(root, '..')
      for (let i = 0; i < 5; i++) {
        const parentPkg = join(dir, 'package.json')
        if (existsSync(parentPkg)) {
          try {
            const parent = JSON.parse(readFileSync(parentPkg, 'utf8'))
            return (
              Array.isArray(parent.workspaces) || parent.workspaces?.packages
            )
          } catch {
            return false
          }
        }
        const next = dirname(dir)
        if (next === dir) break
        dir = next
      }
      return false
    })()

    if (!isMonorepoPkg && !files.includes('!skills/_artifacts')) {
      warnings.push(
        '"!skills/_artifacts" is not in the "files" array — artifacts will be published unnecessarily',
      )
    }
  }

  return warnings
}

function resolvePackageRoot(startDir: string): string {
  let dir = startDir

  while (true) {
    if (existsSync(join(dir, 'package.json'))) {
      return dir
    }

    const next = dirname(dir)
    if (next === dir) {
      return startDir
    }

    dir = next
  }
}

function readPackageName(root: string): string {
  try {
    const pkgJson = JSON.parse(
      readFileSync(join(root, 'package.json'), 'utf8'),
    ) as {
      name?: unknown
    }
    return typeof pkgJson.name === 'string'
      ? pkgJson.name
      : relative(process.cwd(), root) || 'unknown'
  } catch {
    return relative(process.cwd(), root) || 'unknown'
  }
}

async function resolveStaleTargets(targetDir?: string) {
  const resolvedRoot = targetDir
    ? join(process.cwd(), targetDir)
    : process.cwd()
  const { checkStaleness } = await import('./staleness.js')

  if (existsSync(join(resolvedRoot, 'skills'))) {
    return {
      reports: [
        await checkStaleness(resolvedRoot, readPackageName(resolvedRoot)),
      ],
    }
  }

  const { findPackagesWithSkills, findWorkspaceRoot } =
    await import('./setup.js')
  const workspaceRoot = findWorkspaceRoot(resolvedRoot)
  if (workspaceRoot) {
    const packageDirs = findPackagesWithSkills(workspaceRoot)
    if (packageDirs.length > 0) {
      return {
        reports: await Promise.all(
          packageDirs.map((packageDir) =>
            checkStaleness(packageDir, readPackageName(packageDir)),
          ),
        ),
      }
    }
  }

  const staleResult = await scanIntentsOrFail()
  return {
    reports: await Promise.all(
      staleResult.packages.map((pkg) =>
        checkStaleness(pkg.packageRoot, pkg.name),
      ),
    ),
  }
}

async function cmdValidate(args: Array<string>): Promise<void> {
  const [{ parse: parseYaml }, { findSkillFiles }] = await Promise.all([
    import('yaml'),
    import('./utils.js'),
  ])
  const targetDir = args[0] ?? 'skills'
  const skillsDir = join(process.cwd(), targetDir)
  const packageRoot = resolvePackageRoot(skillsDir)

  if (!existsSync(skillsDir)) {
    fail(`Skills directory not found: ${skillsDir}`)
  }

  interface ValidationError {
    file: string
    message: string
  }

  const errors: Array<ValidationError> = []
  const skillFiles = findSkillFiles(skillsDir)

  if (skillFiles.length === 0) {
    fail('No SKILL.md files found')
  }

  for (const filePath of skillFiles) {
    const rel = relative(process.cwd(), filePath)
    const content = readFileSync(filePath, 'utf8')
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)/)

    if (!match) {
      errors.push({ file: rel, message: 'Missing or invalid frontmatter' })
      continue
    }

    if (!match[1]) {
      errors.push({ file: rel, message: 'Missing YAML frontmatter' })
      continue
    }

    let fm: Record<string, unknown>
    try {
      fm = parseYaml(match[1]) as Record<string, unknown>
    } catch {
      errors.push({ file: rel, message: 'Invalid YAML frontmatter' })
      continue
    }

    if (!fm.name)
      errors.push({ file: rel, message: 'Missing required field: name' })
    if (!fm.description)
      errors.push({ file: rel, message: 'Missing required field: description' })

    // Validate name matches directory path
    if (typeof fm.name === 'string') {
      const expectedPath = relative(skillsDir, filePath)
        .replace(/[/\\]SKILL\.md$/, '')
        .split(sep)
        .join('/')
      if (fm.name !== expectedPath) {
        errors.push({
          file: rel,
          message: `name "${fm.name}" does not match directory path "${expectedPath}"`,
        })
      }
    }

    // Description character limit
    if (typeof fm.description === 'string' && fm.description.length > 1024) {
      errors.push({
        file: rel,
        message: `Description exceeds 1024 character limit (${fm.description.length} chars)`,
      })
    }

    // Framework skills must have requires
    if (fm.type === 'framework' && !Array.isArray(fm.requires)) {
      errors.push({
        file: rel,
        message: 'Framework skills must have a "requires" field',
      })
    }

    // Line count
    const lineCount = content.split(/\r?\n/).length
    if (lineCount > 500) {
      errors.push({
        file: rel,
        message: `Exceeds 500 line limit (${lineCount} lines). Rewrite for conciseness: move API tables to references/, trim verbose examples, and remove content an agent already knows. Do not simply raise the limit.`,
      })
    }
  }

  const artifactsDir = join(skillsDir, '_artifacts')
  if (existsSync(artifactsDir)) {
    const requiredArtifacts = [
      'domain_map.yaml',
      'skill_spec.md',
      'skill_tree.yaml',
    ]

    for (const fileName of requiredArtifacts) {
      const artifactPath = join(artifactsDir, fileName)
      if (!existsSync(artifactPath)) {
        errors.push({
          file: relative(process.cwd(), artifactPath),
          message: 'Missing required artifact',
        })
        continue
      }

      const content = readFileSync(artifactPath, 'utf8')
      if (content.trim().length === 0) {
        errors.push({
          file: relative(process.cwd(), artifactPath),
          message: 'Artifact file is empty',
        })
        continue
      }

      if (fileName.endsWith('.yaml')) {
        try {
          parseYaml(content)
        } catch {
          errors.push({
            file: relative(process.cwd(), artifactPath),
            message: 'Invalid YAML in artifact file',
          })
        }
      }
    }
  }

  const warnings = collectPackagingWarnings(packageRoot)

  if (errors.length > 0) {
    fail(buildValidationFailure(errors, warnings))
  }

  console.log(`✅ Validated ${skillFiles.length} skill files — all passed`)
  if (warnings.length > 0) console.log()
  printWarnings(warnings)
}

function cmdScaffold(): void {
  const metaDir = getMetaDir()
  const metaSkillPath = (name: string) => join(metaDir, name, 'SKILL.md')

  const prompt = `You are helping a library maintainer scaffold Intent skills.

Run the three meta skills below **one at a time, in order**. For each step:
1. Load the SKILL.md file specified
2. Follow its instructions completely
3. Present outputs to the maintainer for review
4. Do NOT proceed to the next step until the maintainer confirms

## Before you start

Gather this context yourself (do not ask the maintainer — agents should never
ask for information they can discover):
1. Read package.json for library name, repository URL, and homepage/docs URL
2. Detect if this is a monorepo (look for workspaces field, packages/ directory, lerna.json)
3. Use skills/ as the default skills root
4. For monorepos:
   - Domain map artifacts go at the REPO ROOT: _artifacts/
   - Skills go INSIDE EACH PACKAGE: packages/<pkg>/skills/
   - Identify which packages are client-facing (usually client SDKs and primary framework adapters)

---

## Step 1 — Domain Discovery

Load and follow: ${metaSkillPath('domain-discovery')}

This produces: domain_map.yaml and skill_spec.md in the artifacts directory.
Domain discovery covers the WHOLE library (one domain map even for monorepos).

**STOP. Review outputs with the maintainer before continuing.**

---

## Step 2 — Tree Generator

Load and follow: ${metaSkillPath('tree-generator')}

This produces: skill_tree.yaml in the artifacts directory.
For monorepos, each skill entry should include a \`package\` field.

**STOP. Review outputs with the maintainer before continuing.**

---

## Step 3 — Generate Skills

Load and follow: ${metaSkillPath('generate-skill')}

This produces: individual SKILL.md files.
- Single-repo: skills/<domain>/<skill>/SKILL.md
- Monorepo: packages/<pkg>/skills/<domain>/<skill>/SKILL.md

---

## After all skills are generated

1. Run \`intent validate\` in each package directory
2. Commit skills/ and artifacts
3. For each publishable package, run: \`npx @tanstack/intent edit-package-json\`
4. Ensure each package has \`@tanstack/intent\` as a devDependency
5. Create a \`skill:<skill-name>\` label on the GitHub repo for each skill (use \`gh label create\`)
6. Add a README note: "If you use an AI agent, run \`npx @tanstack/intent@latest install\`"
`

  console.log(prompt)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export const USAGE = `TanStack Intent CLI

Usage:
  intent list [--json]           Discover intent-enabled packages
  intent meta [name]             List meta-skills, or print one by name
  intent validate [<dir>]        Validate skill files (default: skills/)
  intent install                  Print a skill that guides your coding agent to set up skill-to-task mappings
  intent scaffold                Print maintainer scaffold prompt
  intent edit-package-json       Wire package.json (files, keywords) for skill publishing
  intent setup-github-actions    Copy CI workflow templates to .github/workflows/
  intent stale [dir] [--json]    Check skills for staleness`

const HELP_BY_COMMAND: Record<string, string> = {
  list: `${USAGE}

Examples:
  intent list
  intent list --json`,
  meta: `intent meta [name]

List shipped meta-skills, or print a single meta-skill by name.

Examples:
  intent meta
  intent meta domain-discovery`,
  validate: `intent validate [dir]

Validate SKILL.md files in the target directory.

Examples:
  intent validate
  intent validate packages/query/skills`,
  install: `intent install

Print the install prompt used to set up skill-to-task mappings.`,
  scaffold: `intent scaffold

Print the guided maintainer prompt for generating skills.`,
  stale: `intent stale [dir] [--json]

Check installed skills for version and source drift.

Examples:
  intent stale
  intent stale packages/query
  intent stale --json`,
  'edit-package-json': `intent edit-package-json

Update package.json files so skills are published.`,
  'setup-github-actions': `intent setup-github-actions

Copy Intent CI workflow templates into .github/workflows/.`,
}

function isHelpFlag(arg: string | undefined): boolean {
  return arg === '-h' || arg === '--help'
}

function printHelp(command?: string): void {
  if (!command) {
    console.log(`${USAGE}

Run \`intent help <command>\` for details on a specific command.`)
    return
  }

  console.log(HELP_BY_COMMAND[command] ?? USAGE)
}

export async function main(argv: Array<string> = process.argv.slice(2)) {
  const command = argv[0]
  const commandArgs = argv.slice(1)

  try {
    if (!command || isHelpFlag(command)) {
      printHelp()
      return 0
    }

    if (command === 'help') {
      printHelp(commandArgs[0])
      return 0
    }

    if (isHelpFlag(commandArgs[0])) {
      printHelp(command)
      return 0
    }

    switch (command) {
      case 'list':
        await cmdList(commandArgs)
        return 0
      case 'meta':
        await cmdMeta(commandArgs)
        return 0
      case 'validate':
        await cmdValidate(commandArgs)
        return 0
      case 'install': {
        console.log(INSTALL_PROMPT)
        return 0
      }
      case 'scaffold': {
        cmdScaffold()
        return 0
      }
      case 'stale': {
        const jsonStale = commandArgs.includes('--json')
        const targetDir = commandArgs.find((arg) => !arg.startsWith('-'))
        const { reports } = await resolveStaleTargets(targetDir)

        if (reports.length === 0) {
          console.log('No intent-enabled packages found.')
          return 0
        }

        if (jsonStale) {
          console.log(JSON.stringify(reports, null, 2))
          return 0
        }

        for (const report of reports) {
          const driftLabel = report.versionDrift
            ? ` [${report.versionDrift} drift]`
            : ''
          const vLabel =
            report.skillVersion && report.currentVersion
              ? ` (${report.skillVersion} → ${report.currentVersion})`
              : ''
          console.log(`${report.library}${vLabel}${driftLabel}`)

          const stale = report.skills.filter((s) => s.needsReview)
          if (stale.length === 0) {
            console.log('  All skills up-to-date')
          } else {
            for (const skill of stale) {
              console.log(`  ⚠ ${skill.name}: ${skill.reasons.join(', ')}`)
            }
          }
          console.log()
        }
        return 0
      }
      case 'edit-package-json': {
        const { runEditPackageJsonAll } = await import('./setup.js')
        runEditPackageJsonAll(process.cwd())
        return 0
      }
      case 'setup-github-actions': {
        const { runSetupGithubActions } = await import('./setup.js')
        runSetupGithubActions(process.cwd(), getMetaDir())
        return 0
      }
      default:
        printHelp()
        return command ? 1 : 0
    }
  } catch (err) {
    if (isCliFailure(err)) {
      console.error(err.message)
      return err.exitCode
    }

    throw err
  }
}

let isMain = false
try {
  isMain =
    process.argv[1] !== undefined &&
    fileURLToPath(import.meta.url) === realpathSync(process.argv[1])
} catch {}

if (isMain) {
  const exitCode = await main()
  process.exit(exitCode)
}
