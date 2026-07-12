import { dirname, join, relative } from 'node:path'
import { nodeReadFs } from '../shared/utils.js'
import { readSkillFolderContents } from './lockfile/hash.js'
import type { SkillEntry } from '../shared/types.js'
import type { ReadFs } from '../shared/utils.js'

// Static literal-secret heuristics. These catch only obvious common shapes;
// they are defense-in-depth, not proof that content is safe or secret-free.
// Findings expose pattern names and locations, never matched values.
const SECRET_PATTERNS: ReadonlyArray<{
  name: string
  pattern: RegExp
}> = [
  { name: 'github-token', pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { name: 'aws-access-key-id', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  {
    name: 'generic-api-key-assignment',
    pattern:
      /\b(?:api[_-]?key|secret|token|password)\b\s*[:=]\s*["'][A-Za-z0-9_\-.]{16,}["']/i,
  },
  {
    name: 'private-key-block',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  },
  {
    name: 'slack-token',
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  },
]

export interface SecretMatch {
  name: string
  index: number
}

export function findSecretMatches(content: string): Array<SecretMatch> {
  const matches: Array<SecretMatch> = []
  for (const { name, pattern } of SECRET_PATTERNS) {
    const match = pattern.exec(content)
    if (match) matches.push({ name, index: match.index })
  }
  return matches
}

export interface SkillSecretFinding {
  path: string
  patternName: string
}

interface SkillCapabilitySignals {
  path: string
  runsInstallCommand: boolean
  shipsScripts: boolean
  usesNetwork: boolean
}

export interface SkillContentInspection {
  capabilitySignals: Array<SkillCapabilitySignals>
  secretFindings: Array<SkillSecretFinding>
}

const NETWORK_PATTERN = /\b(?:curl|wget|fetch\s*\()/i
const INSTALL_COMMAND_PATTERN =
  /\b(?:npm|pnpm|yarn|bun|pip)\s+(?:i|install|add)\b/i

export function inspectSkillContents(
  packageRoot: string,
  skills: ReadonlyArray<Pick<SkillEntry, 'path'>>,
  fs: ReadFs = nodeReadFs,
): SkillContentInspection {
  const capabilitySignals: Array<SkillCapabilitySignals> = []
  const secretFindings: Array<SkillSecretFinding> = []

  for (const skill of skills) {
    const skillDir = dirname(skill.path)
    const skillPath = relative(packageRoot, skill.path).split('\\').join('/')
    let runsInstallCommand = false
    let shipsScripts = false
    let usesNetwork = false

    for (const entry of readSkillFolderContents(skillDir, packageRoot, fs)) {
      const content = entry.content.toString('utf8')
      runsInstallCommand ||= INSTALL_COMMAND_PATTERN.test(content)
      shipsScripts ||= entry.relativePath.startsWith('scripts/')
      usesNetwork ||= NETWORK_PATTERN.test(content)

      for (const match of findSecretMatches(content)) {
        secretFindings.push({
          path: relative(packageRoot, join(skillDir, entry.relativePath))
            .split('\\')
            .join('/'),
          patternName: match.name,
        })
      }
    }

    capabilitySignals.push({
      path: skillPath,
      runsInstallCommand,
      shipsScripts,
      usesNetwork,
    })
  }

  return { capabilitySignals, secretFindings }
}

export function findSkillSecretFindings(
  packageRoot: string,
  skills: ReadonlyArray<Pick<SkillEntry, 'path'>>,
  fs: ReadFs = nodeReadFs,
): Array<SkillSecretFinding> {
  return inspectSkillContents(packageRoot, skills, fs).secretFindings
}
