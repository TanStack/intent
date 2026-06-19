import {
  appendFileSync,
  existsSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fail, isCliFailure } from '../cli-error.js'
import { printWarnings } from '../cli-support.js'
import { resolveProjectContext } from '../core/project-context.js'
import { findWorkspacePackages } from '../workspace-patterns.js'
import type { ProjectContext } from '../core/project-context.js'

interface ValidationError {
  file: string
  message: string
}

interface ValidationWarning {
  file: string
  message: string
}

interface FrontmatterFixPlan {
  file: string
  filePath: string
  changes: Array<string>
}

export interface ValidateCommandOptions {
  check?: boolean
  fix?: boolean
  githubSummary?: boolean
}

const agentSkillNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

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

const metadataScalarKeys = [
  'type',
  'library',
  'library_version',
  'framework',
] as const

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

function collectPackagingWarnings(context: ProjectContext): Array<string> {
  if (!context.packageRoot || !context.targetPackageJsonPath) return []

  const pkgJsonPath = context.targetPackageJsonPath
  if (!existsSync(pkgJsonPath)) return []

  let pkgJson: Record<string, unknown>
  try {
    pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return [`Could not parse package.json: ${msg}`]
  }

  const warnings: Array<string> = []

  const devDeps = pkgJson.devDependencies as Record<string, string> | undefined
  if (!devDeps?.['@tanstack/intent']) {
    warnings.push('@tanstack/intent is not in devDependencies')
  }

  const keywords = pkgJson.keywords
  if (!Array.isArray(keywords) || !keywords.includes('tanstack-intent')) {
    warnings.push('Missing "tanstack-intent" in keywords array')
  }

  const files = pkgJson.files as Array<string> | undefined
  if (Array.isArray(files)) {
    if (!files.includes('skills')) {
      warnings.push(
        '"skills" is not in the "files" array — skills won\'t be published',
      )
    }

    // In monorepos, _artifacts lives at repo root, not under packages —
    // the negation pattern is a no-op and shouldn't be added.
    if (!context.isMonorepo && !files.includes('!skills/_artifacts')) {
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

function collectFrontmatterFixPlan({
  filePath,
  fm,
  rel,
}: {
  filePath: string
  fm: Record<string, unknown>
  rel: string
}): FrontmatterFixPlan | null {
  const changes: Array<string> = []
  const parentDir = basename(dirname(filePath))

  if (
    typeof fm.name === 'string' &&
    (fm.name.includes('/') || fm.name !== parentDir) &&
    agentSkillNamePattern.test(parentDir)
  ) {
    changes.push(`rewrite name to "${parentDir}"`)
  }

  const metadata = fm.metadata
  const canMoveMetadata = metadata === undefined || isRecord(metadata)
  if (canMoveMetadata) {
    const metadataRecord = isRecord(metadata) ? metadata : undefined
    for (const key of metadataScalarKeys) {
      if (typeof fm[key] !== 'string') continue

      if (metadataRecord && key in metadataRecord) {
        changes.push(
          `remove top-level "${key}"; metadata.${key} already exists`,
        )
      } else {
        changes.push(`move top-level "${key}" under metadata.${key}`)
      }
    }
  }

  return changes.length > 0 ? { file: rel, filePath, changes } : null
}

function normalizeLineEndings(value: string, lineEnding: string): string {
  return lineEnding === '\r\n' ? value.replace(/\r?\n/g, '\r\n') : value
}

async function applyFrontmatterFixes(
  fixPlans: Array<FrontmatterFixPlan>,
): Promise<void> {
  const { parseDocument } = await import('yaml')

  for (const plan of fixPlans) {
    const content = readFileSync(plan.filePath, 'utf8')
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

    const fm = doc.toJS() as Record<string, unknown>
    const parentDir = basename(dirname(plan.filePath))

    if (
      typeof fm.name === 'string' &&
      (fm.name.includes('/') || fm.name !== parentDir) &&
      agentSkillNamePattern.test(parentDir)
    ) {
      doc.set('name', parentDir)
    }

    const metadata = fm.metadata
    const canMoveMetadata = metadata === undefined || isRecord(metadata)
    if (canMoveMetadata) {
      for (const key of metadataScalarKeys) {
        const value = fm[key]
        if (typeof value !== 'string') continue

        if (!doc.hasIn(['metadata', key])) {
          const valueNode = doc.get(key, true)
          doc.setIn(['metadata', key], valueNode ?? value)
        }
        doc.delete(key)
      }
    }

    const nextFrontmatter = normalizeLineEndings(
      doc.toString().replace(/\r?\n$/, ''),
      openingLineEnding,
    )
    const nextContent = `---${openingLineEnding}${nextFrontmatter}${closingLineEnding}---${afterClose}${body}`
    writeFileSync(plan.filePath, nextContent)
  }
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
  dir?: string,
  options: ValidateCommandOptions = {},
): Promise<void> {
  if (options.fix && options.check) {
    fail('Cannot combine --fix and --check')
  }

  if (!options.githubSummary) {
    await runValidateCommandInternal(dir, options)
    return
  }

  try {
    await runValidateCommandInternal(dir, options)
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
  dir?: string,
  options: ValidateCommandOptions = {},
): Promise<void> {
  const [{ parse: parseYaml }, { findSkillFiles, readScalarField }] =
    await Promise.all([import('yaml'), import('../utils.js')])
  const context = resolveProjectContext({
    cwd: process.cwd(),
    targetPath: dir,
  })
  const explicitDir = dir !== undefined
  const skillsDirs = explicitDir
    ? [context.targetSkillsDir ?? resolve(process.cwd(), dir)]
    : collectDefaultSkillsDirs(context, findSkillFiles)

  if (explicitDir && !existsSync(skillsDirs[0]!)) {
    fail(`Skills directory not found: ${skillsDirs[0]}`)
  }

  const errors: Array<ValidationError> = []
  const warnings: Array<string> = []
  const fixPlans: Array<FrontmatterFixPlan> = []
  let validatedCount = 0

  if (explicitDir && findSkillFiles(skillsDirs[0]!).length === 0) {
    fail('No SKILL.md files found')
  }

  if (skillsDirs.length === 0) {
    console.log('No skills/ directory found — skipping validation.')
    return
  }

  for (const skillsDir of skillsDirs) {
    const skillFiles = findSkillFiles(skillsDir)
    const validateContext = resolveProjectContext({
      cwd: process.cwd(),
      targetPath: skillsDir,
    })

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

      const fixPlan = collectFrontmatterFixPlan({ filePath, fm, rel })
      if (fixPlan) fixPlans.push(fixPlan)

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

      if (fm.metadata !== undefined) {
        if (!isRecord(fm.metadata)) {
          errors.push({
            file: rel,
            message: 'metadata must be a mapping',
          })
        } else if (
          Object.values(fm.metadata).some((value) => typeof value !== 'string')
        ) {
          errors.push({
            file: rel,
            message: 'metadata values must be strings',
          })
        }
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

      const lineCount = content.split(/\r?\n/).length
      if (lineCount > 500) {
        errors.push({
          file: rel,
          message: `Exceeds 500 line limit (${lineCount} lines). Rewrite for conciseness: move API tables to references/, trim verbose examples, and remove content an agent already knows. Do not simply raise the limit.`,
        })
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
    warnings.push(...collectPackagingWarnings(validateContext))
  }

  if (options.check) {
    for (const plan of fixPlans) {
      errors.push({
        file: plan.file,
        message: `fixable frontmatter migration pending: ${plan.changes.join('; ')}`,
      })
    }
  }

  if (options.fix && fixPlans.length > 0) {
    await applyFrontmatterFixes(fixPlans)
    console.log(`✅ Fixed ${fixPlans.length} skill files`)
    await runValidateCommandInternal(dir, { ...options, fix: false })
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
      'npx @tanstack/intent@latest validate',
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

function collectDefaultSkillsDirs(
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
