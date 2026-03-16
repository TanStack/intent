#!/usr/bin/env node

import { cac } from 'cac'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { fail, isCliFailure } from './cli-error.js'
import { runInstallCommand } from './commands/install.js'
import { runListCommand } from './commands/list.js'
import { runMetaCommand } from './commands/meta.js'
import { runScaffoldCommand } from './commands/scaffold.js'
import { runStaleCommand } from './commands/stale.js'
import { runValidateCommand } from './commands/validate.js'
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
      await runMetaCommand(name, getMetaDir())
    })

  cli
    .command('validate [dir]', 'Validate skill files')
    .action(async (dir?: string) => {
      await runValidateCommand(dir)
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
        await runStaleCommand(targetDir, options, resolveStaleTargets)
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
