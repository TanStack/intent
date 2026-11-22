export { findSkillFiles } from './shared/skill-files.js'
export { getDeps, resolveDepDir } from './shared/node-modules.js'
export { parseFrontmatter } from './shared/frontmatter.js'
export { scanForIntents } from './discovery/scanner.js'
export { checkStaleness } from './staleness/index.js'
export { readIntentArtifacts } from './staleness/artifact-coverage.js'
export {
  buildStaleReviewBody,
  collectStaleReviewItems,
  createFailedStaleReviewItem,
  type StaleReviewItem,
} from './staleness/workflow-review.js'
export {
  formatSkillUse,
  isSkillUseParseError,
  parseSkillUse,
  SkillUseParseError,
  type SkillUse,
  type SkillUseParseErrorCode,
} from './skills/use.js'
export {
  isResolveSkillUseError,
  resolveSkillUse,
  ResolveSkillUseError,
  type ResolveSkillResult,
  type ResolveSkillUseErrorCode,
} from './skills/resolver.js'
export { runEditPackageJson, runSetupGithubActions } from './setup/index.js'
export type {
  EditPackageJsonResult,
  SetupGithubActionsResult,
} from './setup/index.js'
export type {
  IntentConfig,
  IntentArtifactCoverageIgnore,
  IntentArtifactFile,
  IntentArtifactSet,
  IntentArtifactSkill,
  IntentArtifactWarning,
  IntentPackage,
  ScanOptions,
  ScanResult,
  SkillEntry,
  StalenessReport,
  SkillStaleness,
  StalenessSignal,
} from './shared/types.js'
