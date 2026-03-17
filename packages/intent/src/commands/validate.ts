import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fail } from '../cli-error.js'
import { printWarnings } from '../cli-support.js'

interface ValidationError {
  file: string
  message: string
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

function collectPackagingWarnings(
  root: string,
  isMonorepo: boolean,
): Array<string> {
  const pkgJsonPath = join(root, 'package.json')
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

    if (!isMonorepo && !files.includes('!skills/_artifacts')) {
      warnings.push(
        '"!skills/_artifacts" is not in the "files" array — artifacts will be published unnecessarily',
      )
    }
  }

  return warnings
}

function resolvePackageRoot(startDir: string): string {
  let dir = startDir

  while (true) {
    if (existsSync(join(dir, 'package.json'))) {
      return dir
    }

    const next = dirname(dir)
    if (next === dir) {
      return startDir
    }

    dir = next
  }
}

export async function runValidateCommand(dir?: string): Promise<void> {
  const [{ parse: parseYaml }, { findSkillFiles }] = await Promise.all([
    import('yaml'),
    import('../utils.js'),
  ])
  const targetDir = dir ?? 'skills'
  const skillsDir = join(process.cwd(), targetDir)
  const packageRoot = resolvePackageRoot(skillsDir)

  if (!existsSync(skillsDir)) {
    fail(`Skills directory not found: ${skillsDir}`)
  }

  const errors: Array<ValidationError> = []
  const skillFiles = findSkillFiles(skillsDir)

  if (skillFiles.length === 0) {
    fail('No SKILL.md files found')
  }

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
      errors.push({ file: rel, message: `Invalid YAML frontmatter: ${detail}` })
      continue
    }

    if (!fm.name) {
      errors.push({ file: rel, message: 'Missing required field: name' })
    }
    if (!fm.description) {
      errors.push({ file: rel, message: 'Missing required field: description' })
    }

    if (typeof fm.name === 'string') {
      const expectedPath = relative(skillsDir, filePath)
        .replace(/[/\\]SKILL\.md$/, '')
        .split(sep)
        .join('/')
      if (fm.name !== expectedPath) {
        errors.push({
          file: rel,
          message: `name "${fm.name}" does not match directory path "${expectedPath}"`,
        })
      }
    }

    if (typeof fm.description === 'string' && fm.description.length > 1024) {
      errors.push({
        file: rel,
        message: `Description exceeds 1024 character limit (${fm.description.length} chars)`,
      })
    }

    if (fm.type === 'framework' && !Array.isArray(fm.requires)) {
      errors.push({
        file: rel,
        message: 'Framework skills must have a "requires" field',
      })
    }

    const lineCount = content.split(/\r?\n/).length
    if (lineCount > 500) {
      errors.push({
        file: rel,
        message: `Exceeds 500 line limit (${lineCount} lines). Rewrite for conciseness: move API tables to references/, trim verbose examples, and remove content an agent already knows. Do not simply raise the limit.`,
      })
    }
  }

  const artifactsDir = join(skillsDir, '_artifacts')
  if (existsSync(artifactsDir)) {
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

  const { findWorkspaceRoot } = await import('../setup.js')
  const isMonorepo = findWorkspaceRoot(join(packageRoot, '..')) !== null
  const warnings = collectPackagingWarnings(packageRoot, isMonorepo)

  if (errors.length > 0) {
    fail(buildValidationFailure(errors, warnings))
  }

  console.log(`✅ Validated ${skillFiles.length} skill files — all passed`)
  if (warnings.length > 0) console.log()
  printWarnings(warnings)
}
