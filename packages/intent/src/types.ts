// ---------------------------------------------------------------------------
// Intent config (lives in library package.json under "intent" key)
// ---------------------------------------------------------------------------

export interface IntentConfig {
  version: number
  repo: string
  docs: string
  requires?: Array<string>
}

// ---------------------------------------------------------------------------
// Scanner types
// ---------------------------------------------------------------------------

export interface ScanResult {
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun' | 'unknown'
  packages: Array<IntentPackage>
  warnings: Array<string>
  conflicts: Array<VersionConflict>
  nodeModules: {
    local: NodeModulesScanTarget
    global: NodeModulesScanTarget
  }
}

export interface ScanOptions {
  includeGlobal?: boolean
}

export interface NodeModulesScanTarget {
  path: string | null
  detected: boolean
  exists: boolean
  scanned: boolean
  source?: string
}

export interface IntentPackage {
  name: string
  version: string
  intent: IntentConfig
  skills: Array<SkillEntry>
  packageRoot: string
  source: 'local' | 'global'
}

export interface InstalledVariant {
  version: string
  packageRoot: string
}

export interface VersionConflict {
  packageName: string
  chosen: InstalledVariant
  variants: Array<InstalledVariant>
}

export interface SkillEntry {
  name: string
  path: string
  description: string
  type?: string
  framework?: string
}

// ---------------------------------------------------------------------------
// Staleness types
// ---------------------------------------------------------------------------

export interface StalenessReport {
  library: string
  currentVersion: string | null
  skillVersion: string | null
  versionDrift: 'major' | 'minor' | 'patch' | null
  skills: Array<SkillStaleness>
}

export interface SkillStaleness {
  name: string
  reasons: Array<string>
  needsReview: boolean
}

// ---------------------------------------------------------------------------
// Feedback types
// ---------------------------------------------------------------------------

export interface FeedbackPayload {
  skill: string
  package: string
  skillVersion: string
  task: string
  whatWorked: string
  whatFailed: string
  missing: string
  selfCorrections: string
  userRating: 'good' | 'mixed' | 'bad'
  userComments?: string
}

// ---------------------------------------------------------------------------
// Meta-skill feedback types
// ---------------------------------------------------------------------------

export type MetaSkillName =
  | 'domain-discovery'
  | 'tree-generator'
  | 'generate-skill'
  | 'skill-staleness-check'

export type AgentName = 'claude-code' | 'cursor' | 'copilot' | 'codex' | 'other'

export interface MetaFeedbackPayload {
  metaSkill: MetaSkillName
  library: string
  agentUsed: AgentName
  artifactQuality: 'good' | 'mixed' | 'bad'
  interviewQuality?: 'good' | 'mixed' | 'bad' | 'skipped'
  failureModeQuality?: 'good' | 'mixed' | 'bad' | 'not-applicable'
  whatWorked: string
  whatFailed: string
  suggestions: string
  userRating: 'good' | 'mixed' | 'bad'
}

export type FeedbackFrequency = 'always' | 'never' | `every-${number}`

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

export interface IntentProjectConfig {
  feedback: {
    frequency: FeedbackFrequency
  }
}
