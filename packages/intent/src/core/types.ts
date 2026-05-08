import type {
  IntentPackage,
  ScanScope,
  ScanStats,
  VersionConflict,
} from '../types.js'

export interface IntentCoreOptions {
  cwd?: string
  debug?: boolean
  global?: boolean
  globalOnly?: boolean
  exclude?: Array<string>
}

export interface IntentSkillSummary {
  use: string
  packageName: string
  packageRoot: string
  packageVersion: string
  packageSource: IntentPackage['source']
  skillName: string
  description: string
  type?: string
  framework?: string
}

export interface IntentPackageSummary {
  name: string
  version: string
  source: IntentPackage['source']
  packageRoot: string
  skillCount: number
}

export interface IntentSkillList {
  skills: Array<IntentSkillSummary>
  packages: Array<IntentPackageSummary>
  warnings: Array<string>
  conflicts: Array<VersionConflict>
  debug?: IntentSkillListDebug
}

export interface ResolvedIntentSkill {
  path: string
  packageRoot: string
  packageName: string
  skillName: string
  version: string
  source: IntentPackage['source']
  warnings: Array<string>
  conflict: VersionConflict | null
  debug?: LoadedIntentSkillDebug
}

export interface LoadedIntentSkill extends ResolvedIntentSkill {
  content: string
}

export interface IntentSkillListDebug {
  cwd: string
  scope: ScanScope
  excludes: Array<string>
  packageCount: number
  skillCount: number
  warningCount: number
  conflictCount: number
  scan: IntentScanDebugStats
}

export interface LoadedIntentSkillDebug {
  cwd: string
  scope: ScanScope
  resolution: 'fast-path' | 'full-scan'
  excludes: Array<string>
  packageName: string
  skillName: string
  version: string
  source: IntentPackage['source']
  path: string
  warningCount: number
  scan: IntentScanDebugStats
}

export interface IntentScanDebugStats extends ScanStats {}

export type IntentCoreErrorCode =
  | 'invalid-options'
  | 'invalid-skill-use'
  | 'package-not-found'
  | 'package-excluded'
  | 'skill-not-found'
  | 'skill-path-outside-package'
  | 'skill-file-not-found'
