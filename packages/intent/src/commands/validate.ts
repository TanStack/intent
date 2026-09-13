import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fail, isCliFailure } from '../shared/cli-error.js'
import { resolveProjectContext } from '../core/project-context.js'
import { findWorkspacePackages } from '../setup/workspace-patterns.js'
import { createIntentFsCache } from '../discovery/fs-cache.js'
import { checkSkillBlocks, summarizeSkillExamples } from '../validate/blocks.js'
import { writeChanges } from '../maintainer/files.js'
import { repositoryWritePath } from '../shared/write-path.js'
import {
  agentSkillNamePattern,
  planFrontmatterRepair,
} from '../validate/repairs.js'
import { printWarnings } from './support.js'
import type { FileChange } from '../maintainer/files.js'
import type { ProjectContext } from '../core/project-context.js'

interface ValidationError {
  file: string
  message: string
}

interface ValidationWarning {
  file: string
  message: string
}

interface FrontmatterFixPlan extends FileChange {
  file: string
  changes: Array<string>
}

interface SetVersionPlan {
  file: string
  filePath: string
}

export interface ValidateCommandOptions {
  check?: boolean
  fix?: boolean
  githubSummary?: boolean
  setVersion?: string
}

// The Agent Skills spec allows exactly these six top-level frontmatter keys.
const specTopLevelKeys = new Set([
  'name',
  'description',
  'license',
  'compatibility',
  'metadata',
  'allowed-tools',
])

// Array fields Intent still emits at the top level; their migration to a
// structured surface is tracked separately (#161), so they are not flagged here.
const intentArrayKeys = new Set(['sources', 'requires'])

function isScalarValue(value: unknown): boolean {
  return (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
}

function buildValidationFailure(
  errors: Array<ValidationError>,
  warnings: Array<string>,
): string {
  const lines = ['', `❌ Validation failed with ${errors.length} error(s):`, '']

  for (const { file, message } of errors) {
    lines.push(`  ${file}: ${message}`)
  }

  if (warnings.length > 0) {
    lines.push('', '⚠ Packaging warnings:')
    for (const warning of warnings) {
      lines.push(`  ${warning}`)
    }
  }

  return lines.join('\n')
}

// Positive `files` entries as directory prefixes: `skills`, `skills/`, and
// `skills/**` all publish the whole directory.
function filesPrefixes(files: ReadonlyArray<string>): Array<string> {
  const prefixes: Array<string> = []
  for (const entry of files) {
    if (entry.startsWith('!')) continue
    prefixes.push(entry.replace(/\/(?:\*\*|\*)?$/, ''))
  }
  return prefixes
}

function covered(prefixes: ReadonlyArray<string>, directory: string): boolean {
  return prefixes.some(
    (prefix) => directory === prefix || directory.startsWith(`${prefix}/`),
  )
}

function collectPackagingWarnings(
  context: ProjectContext,
  skillsDir: string,
  skillFiles: ReadonlyArray<string>,
): Array<string> {
  if (!context.packageRoot || !context.targetPackageJsonPath) return []

  const pkgJsonPath = context.targetPackageJsonPath
  if (!existsSync(pkgJsonPath)) return []

  let pkgJson: Record<string, unknown>
  let devDeps: Record<string, string> | undefined
  try {
    pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))
    devDeps = pkgJson.devDependencies as Record<string, string> | undefined
    if (
      !devDeps?.['@tanstack/intent'] &&
      context.workspaceRoot &&
      context.workspaceRoot !== context.packageRoot
    ) {
      const workspaceManifestPath = join(context.workspaceRoot, 'package.json')
      if (existsSync(workspaceManifestPath)) {
        const workspaceManifest = JSON.parse(
          readFileSync(workspaceManifestPath, 'utf8'),
        ) as Record<string, unknown>
        devDeps = workspaceManifest.devDependencies as
          Record<string, string> | undefined
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return [`Could not parse package.json: ${msg}`]
  }

  const warnings: Array<string> = []

  if (!devDeps?.['@tanstack/intent']) {
    warnings.push('@tanstack/intent is not in devDependencies')
  }

  const keywords = pkgJson.keywords
  if (!Array.isArray(keywords) || !keywords.includes('tanstack-intent')) {
    warnings.push('Missing "tanstack-intent" in keywords array')
  }

  const files = pkgJson.files as Array<string> | undefined
  if (Array.isArray(files)) {
    const packageRoot = context.packageRoot
    const prefixes = filesPrefixes(files)
    const skillsRoot = relative(packageRoot, skillsDir).replaceAll('\\', '/')
    // Either the whole skills directory or each skill directory (as written
    // by `intent maintainer sync`) publishes the guidance.
    if (!covered(prefixes, skillsRoot)) {
      const seen = new Set<string>()
      for (const file of skillFiles) {
        const directory = `${skillsRoot}/${relative(skillsDir, dirname(file)).replaceAll('\\', '/')}`
        if (seen.has(directory)) continue
        seen.add(directory)
        if (!covered(prefixes, directory))
          warnings.push(
            `"${directory}" is not covered by the "files" array — this skill won't be published`,
          )
      }
    }

    // In monorepos, _artifacts lives at repo root, not under packages —
    // the negation pattern is a no-op and shouldn't be added.
    if (
      !context.isMonorepo &&
      covered(prefixes, 'skills/_artifacts') &&
      !files.includes('!skills/_artifacts') &&
      existsSync(join(packageRoot, 'skills', '_artifacts'))
    ) {
      warnings.push(
        '"!skills/_artifacts" is not in the "files" array — artifacts will be published unnecessarily',
      )
    }
  }

  return warnings
}

function formatWarning({ file, message }: ValidationWarning): string {
  return `${file}: ${message}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function normalizeLineEndings(value: string, lineEnding: string): string {
  return lineEnding === '\r\n' ? value.replace(/\r?\n/g, '\r\n') : value
}

function repairRoot(): string {
  const context = resolveProjectContext({ cwd: process.cwd() })
  return context.workspaceRoot ?? context.packageRoot ?? context.cwd
}

function applyFrontmatterFixes(plans: Array<FrontmatterFixPlan>): void {
  const root = repairRoot()
  writeChanges(
    root,
    plans.map((plan) => ({
      ...plan,
      path: repositoryWritePath(root, plan.path),
    })),
  )
}

async function applySetVersion(
  plans: Array<SetVersionPlan>,
  version: string,
): Promise<void> {
  const { parseDocument } = await import('yaml')
  const root = repairRoot()
  const changes: Array<FileChange> = []

  for (const plan of plans) {
    const path = repositoryWritePath(root, plan.filePath)
    const content = readFileSync(path, 'utf8')
    const match = content.match(
      /^---(\r?\n)([\s\S]*?)(\r?\n)---(\r?\n?)([\s\S]*)/,
    )
    if (!match) continue

    const openingLineEnding = match[1]
    const frontmatter = match[2]
    const closingLineEnding = match[3]
    const afterClose = match[4]
    const body = match[5]
    if (
      openingLineEnding === undefined ||
      frontmatter === undefined ||
      closingLineEnding === undefined ||
      afterClose === undefined ||
      body === undefined
    ) {
      continue
    }

    const doc = parseDocument(frontmatter)
    if (doc.errors.length > 0) continue

    doc.setIn(['metadata', 'library_version'], version)

    const nextFrontmatter = normalizeLineEndings(
      doc.toString().replace(/\r?\n$/, ''),
      openingLineEnding,
    )
    const nextContent = `---${openingLineEnding}${nextFrontmatter}${closingLineEnding}---${afterClose}${body}`
    changes.push({ path, source: content, content: nextContent })
  }
  writeChanges(root, changes)
}

function collectAgentSkillSpecWarnings({
  fm,
  rel,
}: {
  fm: Record<string, unknown>
  rel: string
}): Array<ValidationWarning> {
  const warnings: Array<ValidationWarning> = []

  if (
    fm.license !== undefined &&
    (typeof fm.license !== 'string' || fm.license.trim().length === 0)
  ) {
    warnings.push({
      file: rel,
      message:
        'Agent Skills spec warning: license should be a non-empty string',
    })
  }

  if (fm.compatibility !== undefined) {
    if (
      typeof fm.compatibility !== 'string' ||
      fm.compatibility.trim().length === 0
    ) {
      warnings.push({
        file: rel,
        message:
          'Agent Skills spec warning: compatibility should be a non-empty string',
      })
    } else if (fm.compatibility.length > 500) {
      warnings.push({
        file: rel,
        message: `Agent Skills spec warning: compatibility exceeds 500 characters (${fm.compatibility.length} chars)`,
      })
    }
  }

  if (
    fm['allowed-tools'] !== undefined &&
    typeof fm['allowed-tools'] !== 'string'
  ) {
    warnings.push({
      file: rel,
      message:
        'Agent Skills spec warning: allowed-tools should be a space-separated string',
    })
  }

  return warnings
}

export async function runValidateCommand(
  dir?: string | Array<string>,
  options: ValidateCommandOptions = {},
  additionalDirs: Array<string> = [],
  exampleSummaries?: Map<string, string>,
): Promise<void> {
  if (options.fix && options.check) {
    fail('Cannot combine --fix and --check')
  }

  if (options.setVersion !== undefined) {
    if (options.check) {
      fail('Cannot combine --set-version and --check')
    }
    if (
      typeof options.setVersion !== 'string' ||
      options.setVersion.trim().length === 0
    ) {
      fail('--set-version requires a non-empty version value')
    }
  }

  if (!options.githubSummary) {
    await runValidateCommandInternal(
      dir,
      options,
      additionalDirs,
      exampleSummaries,
    )
    return
  }

  try {
    await runValidateCommandInternal(
      dir,
      options,
      additionalDirs,
      exampleSummaries,
    )
    writeGithubValidationSummary({ ok: true })
  } catch (err) {
    writeGithubValidationSummary({
      ok: false,
      message: validationErrorMessage(err),
    })
    throw err
  }
}

async function runValidateCommandInternal(
  dir?: string | Array<string>,
  options: ValidateCommandOptions = {},
  additionalDirs: Array<string> = [],
  exampleSummaries?: Map<string, string>,
): Promise<void> {
  const [{ parse: parseYaml }, { readScalarField }] = await Promise.all([
    import('yaml'),
    import('../shared/utils.js'),
  ])
  const { findSkillFiles } = createIntentFsCache()
  // Explicit directories are validated in one run, so a caller with several
  // skills roots gets every error in one report and one summary.
  const explicitDirs = [
    ...new Set([...(dir === undefined ? [] : [dir].flat()), ...additionalDirs]),
  ].map(
    (target) =>
      resolveProjectContext({ cwd: process.cwd(), targetPath: target })
        .targetSkillsDir ?? resolve(process.cwd(), target),
  )
  const skillsDirs = [
    ...new Set([
      ...(dir === undefined
        ? collectDefaultSkillsDirs(
            resolveProjectContext({ cwd: process.cwd() }),
            findSkillFiles,
          )
        : []),
      ...explicitDirs,
    ]),
  ]

  for (const skillsDir of explicitDirs) {
    if (!existsSync(skillsDir)) fail(`Skills directory not found: ${skillsDir}`)
    if (findSkillFiles(skillsDir).length === 0) fail('No SKILL.md files found')
  }

  const errors: Array<ValidationError> = []
  const warnings: Array<string> = []
  const skippedBlockChecks = new Set<string>()
  const fixPlans: Array<FrontmatterFixPlan> = []
  const setVersionPlans: Array<SetVersionPlan> = []
  let validatedCount = 0
  const validatedFiles = new Set<string>()

  if (skillsDirs.length === 0) {
    console.log('No skills/ directory found — skipping validation.')
    return
  }

  for (const skillsDir of skillsDirs) {
    const skillFiles = findSkillFiles(skillsDir).filter((filePath) => {
      if (validatedFiles.has(filePath)) return false
      validatedFiles.add(filePath)
      return true
    })
    const validateContext = resolveProjectContext({
      cwd: process.cwd(),
      targetPath: skillsDir,
    })

    const checkedSkills: Array<{
      file: string
      content: string
      library: string | undefined
    }> = []
    for (const filePath of skillFiles) {
      const rel = relative(process.cwd(), filePath)
      const content = readFileSync(filePath, 'utf8')
      const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)/)

      if (!match) {
        errors.push({ file: rel, message: 'Missing or invalid frontmatter' })
        continue
      }

      if (!match[1]) {
        errors.push({ file: rel, message: 'Missing YAML frontmatter' })
        continue
      }

      let fm: Record<string, unknown>
      try {
        fm = parseYaml(match[1]) as Record<string, unknown>
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        errors.push({
          file: rel,
          message: `Invalid YAML frontmatter: ${detail}`,
        })
        continue
      }

      if (!isRecord(fm)) {
        errors.push({ file: rel, message: 'Frontmatter must be a mapping' })
        continue
      }
      const repair = planFrontmatterRepair(filePath, content)
      if (repair.change)
        fixPlans.push({ ...repair.change, file: rel, changes: repair.changes })
      for (const message of repair.problems) errors.push({ file: rel, message })

      // Only target files whose metadata is a mapping (or absent); a
      // non-mapping metadata scalar is rejected by the repair planner, and
      // setIn cannot safely graft a key onto it.
      if (options.setVersion !== undefined) {
        const meta = fm.metadata
        if (meta === undefined || isRecord(meta)) {
          setVersionPlans.push({ file: rel, filePath })
        }
      }

      if (!fm.name) {
        errors.push({ file: rel, message: 'Missing required field: name' })
      }
      if (!fm.description) {
        errors.push({
          file: rel,
          message: 'Missing required field: description',
        })
      }

      if (typeof fm.name === 'string') {
        const parentDir = basename(dirname(filePath))
        if (fm.name.length > 64) {
          errors.push({
            file: rel,
            message: `name exceeds 64 characters (${fm.name.length} chars)`,
          })
        }
        if (fm.name.includes('/')) {
          errors.push({
            file: rel,
            message: `name "${fm.name}" must be a single leaf segment matching its parent directory "${parentDir}" — the namespace is carried by the directory path, not the name`,
          })
        } else {
          if (fm.name !== parentDir) {
            errors.push({
              file: rel,
              message: `name "${fm.name}" does not match parent directory "${parentDir}"`,
            })
          }
          if (!agentSkillNamePattern.test(fm.name)) {
            errors.push({
              file: rel,
              message: `name "${fm.name}" must use only lowercase letters, numbers, and hyphens`,
            })
          }
        }
      }

      for (const [key, value] of Object.entries(fm)) {
        if (
          !specTopLevelKeys.has(key) &&
          !intentArrayKeys.has(key) &&
          isScalarValue(value)
        ) {
          errors.push({
            file: rel,
            message: `non-spec top-level key "${key}" — move client-specific scalar fields under "metadata"`,
          })
        }
      }

      if (
        isRecord(fm.metadata) &&
        Object.values(fm.metadata).some((value) => typeof value !== 'string')
      ) {
        errors.push({ file: rel, message: 'metadata values must be strings' })
      }

      if (typeof fm.description === 'string' && fm.description.length > 1024) {
        errors.push({
          file: rel,
          message: `Description exceeds 1024 character limit (${fm.description.length} chars)`,
        })
      }

      if (
        readScalarField(fm, 'type') === 'framework' &&
        !Array.isArray(fm.requires)
      ) {
        errors.push({
          file: rel,
          message: 'Framework skills must have a "requires" field',
        })
      }

      warnings.push(
        ...collectAgentSkillSpecWarnings({ fm, rel }).map(formatWarning),
      )

      checkedSkills.push({
        file: rel,
        content,
        library: readScalarField(fm, 'library'),
      })

      const lineCount = content.split(/\r?\n/).length
      if (lineCount > 500) {
        errors.push({
          file: rel,
          message: `Exceeds 500 line limit (${lineCount} lines). Rewrite for conciseness: move API tables to references/, trim verbose examples, and remove content an agent already knows. Do not simply raise the limit.`,
        })
      }
    }

    // Code blocks and links are checked against the owning package's own
    // source, so a renamed export or option fails here with a skill line.
    if (validateContext.packageRoot && checkedSkills.length) {
      let packageName: string | undefined
      try {
        packageName = JSON.parse(
          readFileSync(validateContext.targetPackageJsonPath!, 'utf8'),
        ).name
      } catch {
        packageName = undefined
      }
      const byLibrary: Record<string, typeof checkedSkills> =
        Object.create(null)
      for (const skill of checkedSkills) {
        const library = skill.library ?? packageName
        if (library) (byLibrary[library] ??= []).push(skill)
      }
      for (const [library, skills] of Object.entries(byLibrary)) {
        const result = checkSkillBlocks({
          root: process.cwd(),
          packageDir: validateContext.packageRoot,
          library,
          skills,
        })
        if (exampleSummaries)
          for (const [file, summary] of summarizeSkillExamples(result, skills))
            exampleSummaries.set(resolve(process.cwd(), file), summary)
        if (result.skipped) skippedBlockChecks.add(result.skipped)
        for (const finding of result.findings) {
          if (finding.severity === 'error')
            errors.push({
              file: `${finding.file}:${finding.line}`,
              message: finding.message,
            })
          else
            warnings.push(`${finding.file}:${finding.line}: ${finding.message}`)
        }
      }
    }

    // In monorepos, _artifacts lives at the workspace root, not under each package's skills/ dir.
    const artifactsDir = join(skillsDir, '_artifacts')
    if (!validateContext.isMonorepo && existsSync(artifactsDir)) {
      const requiredArtifacts = [
        'domain_map.yaml',
        'skill_spec.md',
        'skill_tree.yaml',
      ]

      for (const fileName of requiredArtifacts) {
        const artifactPath = join(artifactsDir, fileName)
        if (!existsSync(artifactPath)) {
          errors.push({
            file: relative(process.cwd(), artifactPath),
            message: 'Missing required artifact',
          })
          continue
        }

        const content = readFileSync(artifactPath, 'utf8')
        if (content.trim().length === 0) {
          errors.push({
            file: relative(process.cwd(), artifactPath),
            message: 'Artifact file is empty',
          })
          continue
        }

        if (fileName.endsWith('.yaml')) {
          try {
            parseYaml(content)
          } catch (err) {
            const detail = err instanceof Error ? err.message : String(err)
            errors.push({
              file: relative(process.cwd(), artifactPath),
              message: `Invalid YAML in artifact file: ${detail}`,
            })
          }
        }
      }
    }

    validatedCount += skillFiles.length
    if (skillFiles.length) {
      warnings.push(
        ...collectPackagingWarnings(validateContext, skillsDir, skillFiles),
      )
    }
  }

  for (const reason of skippedBlockChecks)
    warnings.push(`Skill code blocks were not typechecked: ${reason}`)

  if (options.check) {
    for (const plan of fixPlans) {
      errors.push({
        file: plan.file,
        message: `fixable frontmatter migration pending: ${plan.changes.join('; ')}`,
      })
    }
  }

  const willSetVersion =
    options.setVersion !== undefined && setVersionPlans.length > 0
  const willFix = options.fix === true && fixPlans.length > 0

  if (willSetVersion || willFix) {
    if (willFix && willSetVersion) {
      const root = repairRoot()
      for (const plan of setVersionPlans)
        repositoryWritePath(root, plan.filePath)
    }
    if (willFix) {
      applyFrontmatterFixes(fixPlans)
      console.log(`✅ Fixed ${fixPlans.length} skill files`)
    }
    if (willSetVersion) {
      await applySetVersion(setVersionPlans, options.setVersion!)
      console.log(
        `✅ Set library_version to "${options.setVersion}" on ${setVersionPlans.length} skill files`,
      )
    }
    await runValidateCommandInternal(
      dir,
      {
        ...options,
        fix: false,
        setVersion: undefined,
      },
      additionalDirs,
      exampleSummaries,
    )
    return
  }

  if (errors.length > 0) {
    fail(buildValidationFailure(errors, warnings))
  }

  console.log(`✅ Validated ${validatedCount} skill files — all passed`)
  if (warnings.length > 0) console.log()
  printWarnings(warnings)
}

function validationErrorMessage(err: unknown): string {
  if (isCliFailure(err)) return err.message
  if (err instanceof Error) return err.message
  return String(err)
}

function writeGithubValidationSummary({
  message,
  ok,
}: {
  message?: string
  ok: boolean
}): void {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY
  if (!summaryPath) return

  const lines = ['### Intent skill validation', '']
  if (ok) {
    lines.push('Skill validation passed.', '')
  } else {
    lines.push(
      'Skill validation failed.',
      '',
      'Why this failed:',
      '',
      'Intent validates SKILL.md frontmatter, skill names, required fields, size limits, framework requirements, and artifact files.',
      'The command output below contains the exact file-level reasons to fix.',
      '',
      'Run locally:',
      '',
      '```bash',
      'intent validate',
      '```',
      '',
      'Command output:',
      '',
      '```text',
      message ?? 'Unknown validation error.',
      '```',
      '',
    )
  }

  appendFileSync(summaryPath, lines.join('\n'))
}

export function collectDefaultSkillsDirs(
  context: ProjectContext,
  findSkillFiles: (dir: string) => Array<string>,
): Array<string> {
  const skillsDirs: Array<string> = []
  const addSkillsDir = (skillsDir: string): void => {
    if (existsSync(skillsDir) && findSkillFiles(skillsDir).length > 0) {
      skillsDirs.push(skillsDir)
    }
  }

  if (context.workspaceRoot && context.cwd === context.workspaceRoot) {
    addSkillsDir(join(context.workspaceRoot, 'skills'))
    for (const packageDir of findWorkspacePackages(context.workspaceRoot)) {
      addSkillsDir(join(packageDir, 'skills'))
    }
    return [...new Set(skillsDirs)].sort((a, b) => a.localeCompare(b))
  }

  const skillsDir =
    context.targetSkillsDir ??
    (context.packageRoot
      ? join(context.packageRoot, 'skills')
      : resolve(context.cwd, 'skills'))
  addSkillsDir(skillsDir)
  return skillsDirs
}
