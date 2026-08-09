import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type { IntentDiscoveryCondition } from '../corpus/conditions'

export type DeliveryContextMetrics = {
  approximateTokenCount: number
  context: string
  exactLoadCommands: boolean
  injectedBytes: number
  injectionFrequency: 'repository-instruction'
  omittedSkillCount: number
  representedSkillCount: number
  supplementalBytes: number
}

export function measureStaticDeliveryContext({
  condition,
  expectedSkillCount,
  workspacePath,
}: {
  condition: IntentDiscoveryCondition
  expectedSkillCount: number
  workspacePath: string
}): DeliveryContextMetrics | null {
  if (condition !== 'mapped-intent' && condition !== 'mapped-exact-intent') {
    return null
  }

  const context = readFileSync(join(workspacePath, 'AGENTS.md'), 'utf8')
  const injectedBytes = Buffer.byteLength(context)
  const mapRoot = join(workspacePath, '.intent', 'maps')
  const mapContents = existsSync(mapRoot)
    ? readdirSync(mapRoot, { recursive: true })
        .filter((path) => path.endsWith('.md'))
        .map((path) => readFileSync(join(mapRoot, path), 'utf8'))
    : []
  const representedSkillCount =
    condition === 'mapped-exact-intent'
      ? [...context.matchAll(/^\s*- id: /gm)].length
      : mapContents.reduce(
          (total, content) =>
            total + [...content.matchAll(/^- `@[^`]+#[^`]+`:/gm)].length,
          0,
        )
  const supplementalBytes = mapContents.reduce(
    (total, content) => total + Buffer.byteLength(content),
    0,
  )

  return {
    approximateTokenCount: Math.ceil(injectedBytes / 4),
    context,
    exactLoadCommands:
      representedSkillCount > 0 &&
      [...context.matchAll(/^\s*run: "[^"]+ load [^"]+"$/gm)].length ===
        representedSkillCount,
    injectedBytes,
    injectionFrequency: 'repository-instruction',
    omittedSkillCount: Math.max(
      0,
      expectedSkillCount - representedSkillCount,
    ),
    representedSkillCount,
    supplementalBytes,
  }
}