// ---------------------------------------------------------------------------
// Intent config (lives in library package.json under "intent" key)
// ---------------------------------------------------------------------------

export interface IntentConfig {
  version: number
  repo: string
  docs: string
  requires?: string[]
}

// ---------------------------------------------------------------------------
// Scanner types
// ---------------------------------------------------------------------------

export interface ScanResult {
  packageManager: 'npm' | 'pnpm' | 'yarn' | 'bun' | 'unknown'
  packages: IntentPackage[]
  warnings: string[]
}

export interface IntentPackage {
  name: string
  version: string
  intent: IntentConfig
  skills: SkillEntry[]
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
  skills: SkillStaleness[]
}

export interface SkillStaleness {
  name: string
  reasons: string[]
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

// ---------------------------------------------------------------------------
// Config types
// ---------------------------------------------------------------------------

export interface IntentProjectConfig {
  feedback: {
    frequency: string // "always" | "every-N" | "never"
  }
}
