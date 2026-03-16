#!/usr/bin/env node

import { cac } from 'cac'
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fail, isCliFailure } from './cli-error.js'
import { runInstallCommand } from './commands/install.js'
import { runListCommand } from './commands/list.js'
import { runScaffoldCommand } from './commands/scaffold.js'
import type { ScanResult } from './types.js'

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

function getMetaDir(): string {
  const thisDir = dirname(fileURLToPath(import.meta.url))
  return join(thisDir, '..', 'meta')
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

function createCli() {
  const cli = cac('intent')

  cli
    .command('list', 'Discover intent-enabled packages')
    .option('--json', 'Output JSON')
    .action(async (options: { json?: boolean }) => {
      await runListCommand(options, scanIntentsOrFail)
    })

  cli
    .command('meta [name]', 'List meta-skills, or print one by name')
    .action(async (name?: string) => {
      await cmdMeta(name ? [name] : [])
    })

  cli
    .command('validate [dir]', 'Validate skill files')
    .action(async (dir?: string) => {
      await cmdValidate(dir ? [dir] : [])
    })

  cli
    .command(
      'install',
      'Print a skill that guides your coding agent to set up skill-to-task mappings',
    )
    .action(() => {
      runInstallCommand()
    })

  cli.command('scaffold', 'Print maintainer scaffold prompt').action(() => {
    runScaffoldCommand(getMetaDir())
  })

  cli
    .command('stale [dir]', 'Check skills for staleness')
    .option('--json', 'Output JSON')
    .action(
      async (targetDir: string | undefined, options: { json?: boolean }) => {
        const { reports } = await resolveStaleTargets(targetDir)

        if (reports.length === 0) {
          console.log('No intent-enabled packages found.')
          return
        }

        if (options.json) {
          console.log(JSON.stringify(reports, null, 2))
          return
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
      },
    )

  cli
    .command(
      'edit-package-json',
      'Update package.json files so skills are published',
    )
    .action(async () => {
      const { runEditPackageJsonAll } = await import('./setup.js')
      runEditPackageJsonAll(process.cwd())
    })

  cli
    .command(
      'setup-github-actions',
      'Copy Intent CI workflow templates into .github/workflows/',
    )
    .action(async () => {
      const { runSetupGithubActions } = await import('./setup.js')
      runSetupGithubActions(process.cwd(), getMetaDir())
    })

  return cli
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

    if (!(command in HELP_BY_COMMAND)) {
      printHelp()
      return command ? 1 : 0
    }

    const cli = createCli()
    cli.help()
    cli.parse(['intent', 'intent', ...argv], { run: false })
    await cli.runMatchedCommand()
    return 0
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
