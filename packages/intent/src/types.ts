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
  packageManager: PackageManager
  packages: Array<IntentPackage>
  warnings: Array<string>
  notices: Array<string>
  conflicts: Array<VersionConflict>
  nodeModules: {
    local: NodeModulesScanTarget
    global: NodeModulesScanTarget
  }
  stats: ScanStats
}

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun' | 'unknown'

export type ScanScope = 'local' | 'local-and-global' | 'global'

export interface ScanOptions {
  includeGlobal?: boolean
  scope?: ScanScope
}

export interface ScanStats {
  packageJsonReadCount: number
  packageJsonCacheHits: number
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
  kind: 'npm' | 'workspace'
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
  signals: Array<StalenessSignal>
}

export interface SkillStaleness {
  name: string
  reasons: Array<string>
  needsReview: boolean
}

export interface StalenessSignal {
  type: string
  library?: string
  subject?: string
  reasons: Array<string>
  needsReview: boolean
  artifactPath?: string
  packageName?: string
  packageRoot?: string
  skill?: string
}

export interface IntentArtifactSet {
  root: string
  artifactsDir: string
  skillTrees: Array<IntentArtifactFile>
  domainMaps: Array<IntentArtifactFile>
  skills: Array<IntentArtifactSkill>
  ignoredPackages: Array<IntentArtifactCoverageIgnore>
  warnings: Array<IntentArtifactWarning>
}

export interface IntentArtifactFile {
  path: string
  kind: 'skill-tree' | 'domain-map'
  libraryName?: string
  libraryVersion?: string
}

export interface IntentArtifactSkill {
  artifactPath: string
  artifactKind: 'skill-tree' | 'domain-map'
  name?: string
  slug?: string
  path?: string
  package?: string
  packages: Array<string>
  sources: Array<string>
  covers: Array<string>
}

export interface IntentArtifactCoverageIgnore {
  packageName: string
  reason?: string
  artifactPath: string
}

export interface IntentArtifactWarning {
  artifactPath: string
  message: string
}
