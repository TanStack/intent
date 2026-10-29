import { configureIntentSkill, resolveIntentSkill } from '../core/index.js'
import { detectInvocationPrefix } from '../transforms/commands.js'
import { parseAnswerPairs, readConfigureStdin } from '../transforms/runtime.js'
import { coreOptionsFromGlobalFlags } from './support.js'
import type { GlobalScanFlags } from './support.js'

export interface ConfigureCommandOptions extends GlobalScanFlags {
  answer?: string | Array<string>
  reset?: boolean
}

export async function runConfigureCommand(
  use: string | undefined,
  options: ConfigureCommandOptions,
): Promise<void> {
  if (!use)
    throw new Error(
      'Missing skill use. Expected: intent configure <package>#<skill>',
    )
  const answers = parseAnswerPairs(options.answer)
  const coreOptions = coreOptionsFromGlobalFlags(options)
  // Refuse excluded/missing skills before waiting for piped input.
  resolveIntentSkill(use, coreOptions)
  const stdin = await readConfigureStdin()
  coreOptions.commandPrefix = detectInvocationPrefix()
  const configured = configureIntentSkill(
    use,
    { answers, stdin, reset: options.reset },
    coreOptions,
  )
  process.stdout.write(configured.content)
  for (const warning of configured.warnings)
    console.error(`Warning: ${warning}`)
}
