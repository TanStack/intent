#!/usr/bin/env node

import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { cac } from 'cac'
import { fail, isCliFailure } from './shared/cli-error.js'
import type { CAC } from 'cac'
import type { ExcludeCommandOptions } from './commands/exclude.js'
import type { HooksInstallCommandOptions } from './commands/hooks/command.js'
import type { InstallCommandOptions } from './commands/install/command.js'
import type { ListCommandOptions } from './commands/list.js'
import type { LoadCommandOptions } from './commands/load.js'
import type { StaleCommandOptions } from './commands/stale.js'
import type { ValidateCommandOptions } from './commands/validate.js'

function createCli(): CAC {
  const cli = cac('intent')
  cli.usage('<command> [options]')

  cli
    .command(
      'list',
      'Discover intent-enabled packages from the project or workspace',
    )
    .usage(
      'list [--json] [--debug] [--global] [--global-only] [--show-hidden] [--no-notices]',
    )
    .option('--json', 'Output JSON')
    .option('--debug', 'Print discovery debug details to stderr')
    .option('--global', 'Include global packages after project packages')
    .option('--global-only', 'List global packages only')
    .option(
      '--show-hidden',
      'Show hidden skill sources not listed in intent.skills',
    )
    .option('--no-notices', 'Suppress non-critical notices on stderr')
    .example('list')
    .example('list --json')
    .example('list --global')
    .action(async (options: ListCommandOptions) => {
      const { runListCommand } = await import('./commands/list.js')
      await runListCommand(options)
    })

  cli
    .command(
      'exclude [action] [pattern]',
      'Manage package.json intent.exclude entries',
    )
    .usage('exclude [list|add|remove] [pattern] [--json]')
    .option('--json', 'Output JSON list of configured exclude patterns')
    .example('exclude')
    .example('exclude list --json')
    .example('exclude add @tanstack/router#experimental-*')
    .example('exclude remove @tanstack/router#experimental-*')
    .action(
      async (
        action: string | undefined,
        pattern: string | undefined,
        options: ExcludeCommandOptions,
      ) => {
        const { runExcludeCommand } = await import('./commands/exclude.js')
        await runExcludeCommand(action, pattern, options)
      },
    )

  cli
    .command('load [use]', 'Load a compact skill use and print its SKILL.md')
    .usage('load <use> [--path] [--json] [--debug] [--global] [--global-only]')
    .option('--path', 'Print the resolved skill path instead of file content')
    .option('--json', 'Output JSON')
    .option('--debug', 'Print resolution debug details to stderr')
    .option('--global', 'Load from project packages, then global packages')
    .option('--global-only', 'Load from global packages only')
    .example('load @tanstack/query#core')
    .example('load @tanstack/query#core --path')
    .action(async (use: string | undefined, options: LoadCommandOptions) => {
      const { runLoadCommand } = await import('./commands/load.js')
      await runLoadCommand(use, options)
    })

  cli
    .command('meta [name]', 'List meta-skills, or print one by name')
    .usage('meta [name]')
    .example('meta')
    .example('meta domain-discovery')
    .action(async (name?: string) => {
      const [{ getMetaDir }, { runMetaCommand }] = await Promise.all([
        import('./commands/support.js'),
        import('./commands/meta.js'),
      ])
      await runMetaCommand(name, getMetaDir())
    })

  cli
    .command('validate [dir]', 'Validate skill files')
    .usage('validate [dir] [--github-summary] [--fix] [--check]')
    .option('--github-summary', 'Write a GitHub Actions step summary')
    .option('--fix', 'Rewrite fixable SKILL.md frontmatter issues')
    .option(
      '--check',
      'Fail if fixable SKILL.md frontmatter issues would be rewritten',
    )
    .example('validate')
    .example('validate packages/query/skills')
    .action(
      async (dir: string | undefined, options: ValidateCommandOptions) => {
        const { runValidateCommand } = await import('./commands/validate.js')
        await runValidateCommand(dir, options)
      },
    )

  cli
    .command(
      'install',
      'Create or update skill loading guidance in an agent config file',
    )
    .usage(
      'install [--map] [--dry-run] [--print-prompt] [--global] [--global-only] [--no-notices]',
    )
    .option('--map', 'Write explicit skill-to-task mappings')
    .option('--dry-run', 'Print the generated block without writing')
    .option(
      '--print-prompt',
      'Print the legacy agent setup prompt instead of writing',
    )
    .option('--global', 'Include global packages after project packages')
    .option('--global-only', 'Install mappings from global packages only')
    .option('--no-notices', 'Suppress non-critical notices on stderr')
    .example('install')
    .example('install --map')
    .example('install --dry-run')
    .example('install --print-prompt')
    .example('install --global')
    .action(async (options: InstallCommandOptions) => {
      const [{ scanIntentsOrFail }, { runInstallCommand }] = await Promise.all([
        import('./commands/support.js'),
        import('./commands/install/command.js'),
      ])
      await runInstallCommand(options, scanIntentsOrFail)
    })

  cli
    .command(
      'hooks [action]',
      'Manage agent hooks that surface and enforce skill loading',
    )
    .usage(
      'hooks install [--scope project|user] [--agents copilot,claude,codex|all]',
    )
    .option('--scope <scope>', 'Hook install scope: project or user')
    .option('--agents <agents>', 'Hook agents: copilot,claude,codex, or all')
    .example('hooks install')
    .example('hooks install --scope user --agents copilot')
    .action(
      async (
        action: string | undefined,
        options: HooksInstallCommandOptions,
      ) => {
        if (action !== 'install') {
          fail('Unknown hooks action: expected install.')
        }

        const { runHooksInstallCommand } =
          await import('./commands/hooks/command.js')
        runHooksInstallCommand(options)
      },
    )

  cli
    .command('scaffold', 'Print maintainer scaffold prompt')
    .usage('scaffold')
    .action(async () => {
      const [{ getMetaDir }, { runScaffoldCommand }] = await Promise.all([
        import('./commands/support.js'),
        import('./commands/scaffold.js'),
      ])
      runScaffoldCommand(getMetaDir())
    })

  cli
    .command(
      'stale [dir]',
      'Check skills for staleness in the current package or workspace',
    )
    .usage('stale [dir] [--json] [--github-review]')
    .option('--json', 'Output JSON')
    .option('--github-review', 'Write GitHub Actions review PR files')
    .option('--package-label <label>', 'Fallback package label for review PRs')
    .example('stale')
    .example('stale packages/query')
    .example('stale --json')
    .action(
      async (targetDir: string | undefined, options: StaleCommandOptions) => {
        const [{ resolveStaleTargets }, { runStaleCommand }] =
          await Promise.all([
            import('./commands/support.js'),
            import('./commands/stale.js'),
          ])
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
      const { runEditPackageJsonCommand } =
        await import('./commands/setup/edit-package-json.js')
      await runEditPackageJsonCommand(process.cwd())
    })

  cli
    .command(
      'setup',
      'Copy Intent CI workflow templates into .github/workflows/',
    )
    .usage('setup')
    .action(async () => {
      const [{ getMetaDir }, { runSetupGithubActionsCommand }] =
        await Promise.all([
          import('./commands/support.js'),
          import('./commands/setup/github-actions.js'),
        ])
      await runSetupGithubActionsCommand(process.cwd(), getMetaDir())
    })

  cli
    .command(
      'setup-github-actions',
      'Copy Intent CI workflow templates into .github/workflows/',
    )
    .usage('setup-github-actions')
    .action(async () => {
      const [{ getMetaDir }, { runSetupGithubActionsCommand }] =
        await Promise.all([
          import('./commands/support.js'),
          import('./commands/setup/github-actions.js'),
        ])
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

export function isMainModule(
  metaUrl: string,
  argvPath: string | undefined,
  realpath: (path: string) => string = realpathSync,
): boolean {
  if (argvPath === undefined) {
    return false
  }
  try {
    return fileURLToPath(metaUrl) === realpath(argvPath)
  } catch {
    return false
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  const exitCode = await main()
  process.exit(exitCode)
}
