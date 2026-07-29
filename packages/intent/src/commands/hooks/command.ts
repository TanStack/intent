import {
  formatHookInstallResult,
  runInstallHooks,
} from '../../hooks/install.js'

export interface HooksInstallCommandOptions {
  agents?: string
  scope?: string
}

export function runHooksInstallCommand(
  options: HooksInstallCommandOptions,
): void {
  const results = runInstallHooks({
    agents: options.agents,
    root: process.cwd(),
    scope: options.scope,
  })

  for (const result of results) {
    console.log(formatHookInstallResult(result))
  }
}
