import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { PlaybookProjectConfig } from './types.js'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGENT_CONFIG_FILES = [
  'AGENTS.md',
  'CLAUDE.md',
  '.cursorrules',
  '.github/copilot-instructions.md',
] as const

const PLAYBOOK_BLOCK_MARKER = '## Playbook Skills'

const PLAYBOOK_BLOCK = `## Playbook Skills

This project uses TanStack Playbooks. Run \`npx playbook list\` to discover
available AI coding skills. Before working with a library that has skills,
read the relevant SKILL.md file at the path shown in the list output.
`

const DEFAULT_CONFIG: PlaybookProjectConfig = {
  feedback: {
    frequency: 'every-5',
  },
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

export function detectAgentConfigs(root: string): string[] {
  return AGENT_CONFIG_FILES
    .map((f) => join(root, f))
    .filter((f) => existsSync(f))
}

// ---------------------------------------------------------------------------
// Injection
// ---------------------------------------------------------------------------

export function hasPlaybookBlock(filePath: string): boolean {
  try {
    const content = readFileSync(filePath, 'utf8')
    return content.includes(PLAYBOOK_BLOCK_MARKER)
  } catch {
    return false
  }
}

export function injectPlaybookBlock(filePath: string): boolean {
  if (hasPlaybookBlock(filePath)) return false

  let content: string
  try {
    content = readFileSync(filePath, 'utf8')
  } catch {
    content = ''
  }

  const separator = content.length > 0 && !content.endsWith('\n\n') ? '\n\n' : ''
  const updated = content + separator + PLAYBOOK_BLOCK
  writeFileSync(filePath, updated)
  return true
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export function writeProjectConfig(root: string): string {
  const configPath = join(root, 'playbook.config.json')
  if (!existsSync(configPath)) {
    writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n')
  }
  return configPath
}

export function readProjectConfig(root: string): PlaybookProjectConfig | null {
  const configPath = join(root, 'playbook.config.json')
  try {
    return JSON.parse(readFileSync(configPath, 'utf8')) as PlaybookProjectConfig
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Main init command
// ---------------------------------------------------------------------------

export interface InitResult {
  injected: string[]
  skipped: string[]
  created: string[]
  configPath: string
}

export function runInit(root: string): InitResult {
  const detected = detectAgentConfigs(root)
  const injected: string[] = []
  const skipped: string[] = []
  const created: string[] = []

  for (const filePath of detected) {
    if (injectPlaybookBlock(filePath)) {
      injected.push(filePath)
    } else {
      skipped.push(filePath)
    }
  }

  const configPath = writeProjectConfig(root)

  return { injected, skipped, created, configPath }
}
