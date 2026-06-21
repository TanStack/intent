import {
  formatHookInstallResult,
  runInstallHooks,
  validateHookInstallOptions,
} from '../../hooks/install.js'

export interface HooksInstallCommandOptions {
  agents?: string
  scope?: string
}

export function runHooksInstallCommand(
  options: HooksInstallCommandOptions,
): void {
  validateHookInstallOptions(options)

  const results = runInstallHooks({
    agents: options.agents,
    root: process.cwd(),
    scope: options.scope,
  })

  for (const result of results) {
    console.log(formatHookInstallResult(result))
  }
}
