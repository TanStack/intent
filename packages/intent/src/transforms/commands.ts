import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import type { TransformCommands } from './types.js'

function quote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'"
}

/** Only these metadata fields are inspected; the environment is never sent to a transform. */
interface Invocation {
  env: NodeJS.ProcessEnv
  ancestors: Array<string>
  executable: string
  script: string | undefined
  scripts: Record<string, string>
}

function reusableScript(script: string): boolean {
  // Fixed actions and compound shell scripts cannot be safely reused for both operations.
  return (
    !/[;&|`\n$]/.test(script) &&
    !/\b(load|configure)\b/.test(script) &&
    /(?:\bintent|\bcli\.(?:mjs|js)|@tanstack\/intent(?:@[\w.+-]+)?)['"]?\s*$/.test(
      script,
    )
  )
}

/** Recover launcher semantics, not the original shell's whitespace or quoting. */
export function invocationPrefix(invocation: Invocation): string {
  const { env, ancestors, scripts } = invocation
  const manager =
    env.npm_config_user_agent?.match(/^(npm|pnpm|yarn|bun)\//)?.[1] ?? 'npm'
  const scriptCommand = (name: string, pm = manager) =>
    `${pm} run ${quote(name)}${pm === 'npm' ? ' --' : ''}`
  const event = env.npm_lifecycle_event
  if (
    event &&
    event !== 'npx' &&
    event !== 'exec' &&
    reusableScript(scripts[event] ?? env.npm_lifecycle_script ?? '')
  )
    return scriptCommand(event)

  // A nested npx overwrites lifecycle metadata. Recover a reusable outer npm script.
  for (const command of ancestors) {
    const match = command.match(
      /^(npm|pnpm|yarn|bun) (?:run|run-script) ([\w:.-]+)(?:\s|$)/,
    )
    if (match && reusableScript(scripts[match[2]!] ?? ''))
      return scriptCommand(match[2]!, match[1])
  }
  for (const command of ancestors) {
    const match = command.match(
      /^(npx|npm exec|pnpm dlx|yarn dlx|bunx)\s+(?:--yes\s+|--\s+)?(@tanstack\/intent(?:@[\w.+-]+)?)(?:\s|$)/,
    )
    if (match)
      return `${match[1] === 'npm exec' ? 'npx' : match[1]} ${match[2]}`
  }
  const spec = env.npm_config_package
  if (
    env.npm_command === 'exec' &&
    spec &&
    /^@tanstack\/intent(?:@[\w.+-]+)?$/.test(spec)
  )
    return `npx ${spec}`
  if (env.npm_command === 'exec') return 'npm exec --no -- intent'
  if (manager === 'pnpm' && env.npm_execpath) return 'pnpm exec intent'
  if (manager === 'yarn' && env.npm_execpath) return 'yarn exec intent'
  if (
    invocation.script &&
    /^intent(?:\.cmd)?$/.test(basename(invocation.script))
  )
    return quote(invocation.script)
  return invocation.script
    ? `${quote(invocation.executable)} ${quote(invocation.script)}`
    : 'intent'
}

export function detectInvocationPrefix(): string {
  const ancestors: Array<string> = []
  // npm does not consistently forward the original package spec/tag to its child.
  // Inspect only a few launcher ancestors, without executing any recovered text.
  if (process.platform !== 'win32') {
    let pid = process.ppid
    for (let i = 0; i < 4 && pid > 1; i++) {
      const result = spawnSync(
        'ps',
        ['-p', String(pid), '-o', 'ppid=', '-o', 'args='],
        {
          encoding: 'utf8',
          timeout: 250,
          maxBuffer: 16384,
        },
      )
      if (result.error || result.status !== 0) break
      const match = result.stdout.trim().match(/^(\d+)\s+([\s\S]+)$/)
      if (!match || Number(match[1]) === pid) break
      ancestors.push(match[2]!)
      pid = Number(match[1])
    }
  }
  let scripts: Record<string, string> = {}
  if (process.env.npm_package_json) {
    try {
      const value = JSON.parse(
        readFileSync(process.env.npm_package_json, 'utf8'),
      ).scripts
      if (value && typeof value === 'object')
        scripts = Object.fromEntries(
          Object.entries(value).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string',
          ),
        )
    } catch {
      /* Missing metadata falls back to the current executable. */
    }
  }
  return invocationPrefix({
    env: process.env,
    ancestors,
    scripts,
    executable: process.execPath,
    script: process.argv[1],
  })
}

export function transformCommands(
  use: string,
  options: { commandPrefix?: string; global?: boolean; globalOnly?: boolean },
): TransformCommands {
  const prefix = options.commandPrefix ?? 'intent'
  const flags = options.globalOnly
    ? ' --global-only'
    : options.global
      ? ' --global'
      : ''
  return {
    load: `${prefix} load ${quote(use)}${flags}`,
    configure: `${prefix} configure ${quote(use)}${flags}`,
  }
}
