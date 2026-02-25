// ---------------------------------------------------------------------------
// Playbook config (lives in library package.json under "playbook" key)
// ---------------------------------------------------------------------------

export interface PlaybookConfig {
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
  packages: PlaybookPackage[]
  warnings: string[]
}

export interface PlaybookPackage {
  name: string
  version: string
  playbook: PlaybookConfig
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
// Config types
// ---------------------------------------------------------------------------

export interface PlaybookProjectConfig {
  feedback: {
    frequency: string // "always" | "every-N" | "never"
  }
}
