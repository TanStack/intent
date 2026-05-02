import type { IntentPackage, VersionConflict } from '../types.js'

export interface IntentCoreOptions {
  cwd?: string
  global?: boolean
  globalOnly?: boolean
  exclude?: Array<string>
}

export interface IntentSkillSummary {
  use: string
  packageName: string
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
  skillCount: number
}

export interface IntentSkillList {
  skills: Array<IntentSkillSummary>
  packages: Array<IntentPackageSummary>
  warnings: Array<string>
  conflicts: Array<VersionConflict>
}

export interface LoadedIntentSkill {
  content: string
  path: string
  packageRoot: string
  packageName: string
  skillName: string
  version: string
  source: IntentPackage['source']
  warnings: Array<string>
  conflict: VersionConflict | null
}

export type IntentCoreErrorCode =
  | 'invalid-options'
  | 'invalid-skill-use'
  | 'package-not-found'
  | 'package-excluded'
  | 'skill-not-found'
  | 'skill-path-outside-package'
  | 'skill-file-not-found'
