#!/usr/bin/env node

import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { type CAC, cac } from 'cac'
import { fail, isCliFailure } from './cli-error.js'
import {
  getMetaDir,
  resolveStaleTargets,
  scanIntentsOrFail,
} from './cli-support.js'
import { runEditPackageJsonCommand } from './commands/edit-package-json.js'
import { runInstallCommand } from './commands/install.js'
import { runListCommand } from './commands/list.js'
import { runMetaCommand } from './commands/meta.js'
import { runScaffoldCommand } from './commands/scaffold.js'
import { runSetupGithubActionsCommand } from './commands/setup-github-actions.js'
import { runStaleCommand } from './commands/stale.js'
import { runValidateCommand } from './commands/validate.js'

function createCli(): CAC {
  const cli = cac('intent')
  cli.usage('<command> [options]')

  cli
    .command(
      'list',
      'Discover intent-enabled packages from the project, workspace, and explicit global scan',
    )
    .usage('list [--json]')
    .option('--json', 'Output JSON')
    .example('list')
    .example('list --json')
    .action(async (options: { json?: boolean }) => {
      await runListCommand(options, () =>
        scanIntentsOrFail({ includeGlobal: true }),
      )
    })

  cli
    .command('meta [name]', 'List meta-skills, or print one by name')
    .usage('meta [name]')
    .example('meta')
    .example('meta domain-discovery')
    .action(async (name?: string) => {
      await runMetaCommand(name, getMetaDir())
    })

  cli
    .command('validate [dir]', 'Validate skill files')
    .usage('validate [dir]')
    .example('validate')
    .example('validate packages/query/skills')
    .action(async (dir?: string) => {
      await runValidateCommand(dir)
    })

  cli
    .command(
      'install',
      'Print a skill that guides your coding agent to set up skill-to-task mappings',
    )
    .usage('install')
    .action(() => {
      runInstallCommand()
    })

  cli
    .command('scaffold', 'Print maintainer scaffold prompt')
    .usage('scaffold')
    .action(() => {
      runScaffoldCommand(getMetaDir())
    })

  cli
    .command('stale [dir]', 'Check skills for staleness')
    .usage('stale [dir] [--json]')
    .option('--json', 'Output JSON')
    .example('stale')
    .example('stale packages/query')
    .example('stale --json')
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
    .usage('edit-package-json')
    .action(async () => {
      await runEditPackageJsonCommand(process.cwd())
    })

  cli
    .command(
      'setup-github-actions',
      'Copy Intent CI workflow templates into .github/workflows/',
    )
    .usage('setup-github-actions')
    .action(async () => {
      await runSetupGithubActionsCommand(process.cwd(), getMetaDir())
    })

  cli
    .command('help [command]', 'Display help for a command')
    .action((commandName?: string) => {
      if (!commandName) {
        cli.outputHelp()
        return
      }

      const command = cli.commands.find((candidate) =>
        candidate.isMatched(commandName),
      )

      if (!command) {
        fail(`Unknown command: ${commandName}`)
      }

      command.outputHelp()
    })

  cli.help()

  return cli
}

export async function main(argv: Array<string> = process.argv.slice(2)) {
  try {
    const cli = createCli()

    if (argv.length === 0) {
      cli.outputHelp()
      return 0
    }

    // cac expects process.argv format: first two entries (binary + script) are ignored
    cli.parse(['intent', 'intent', ...argv], { run: false })

    if (cli.options.help) {
      return 0
    }

    if (!cli.matchedCommand) {
      cli.outputHelp()
      return 1
    }

    await cli.runMatchedCommand()
    return 0
  } catch (err) {
    if (isCliFailure(err)) {
      console.error(err.message)
      return err.exitCode
    }

    if (err instanceof Error) {
      console.error(err.message)
      return 1
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
