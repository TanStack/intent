#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { computeSkillNameWidth, printSkillTree, printTable } from './display.js'
import { scanForIntents } from './scanner.js'
import type { ScanResult } from './types.js'
import { findSkillFiles, parseFrontmatter } from './utils.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getMetaDir(): string {
  const thisDir = dirname(fileURLToPath(import.meta.url))
  return join(thisDir, '..', 'meta')
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

async function cmdList(args: string[]): Promise<void> {
  const jsonOutput = args.includes('--json')

  let result: ScanResult
  try {
    result = await scanForIntents()
  } catch (err) {
    console.error((err as Error).message)
    process.exit(1)
  }

  if (jsonOutput) {
    console.log(JSON.stringify(result, null, 2))
    return
  }

  if (result.packages.length === 0) {
    console.log('No intent-enabled packages found.')
    if (result.warnings.length > 0) {
      console.log(`\nWarnings:`)
      for (const w of result.warnings) console.log(`  ⚠ ${w}`)
    }
    return
  }

  const totalSkills = result.packages.reduce(
    (sum, p) => sum + p.skills.length,
    0,
  )
  console.log(
    `\n${result.packages.length} intent-enabled packages, ${totalSkills} skills (${result.packageManager})\n`,
  )

  // Summary table
  const rows = result.packages.map((pkg) => [
    pkg.name,
    pkg.version,
    String(pkg.skills.length),
    pkg.intent.requires?.join(', ') || '–',
  ])
  printTable(['PACKAGE', 'VERSION', 'SKILLS', 'REQUIRES'], rows)

  // Skills detail
  const allSkills = result.packages.map((p) => p.skills)
  const nameWidth = computeSkillNameWidth(allSkills)
  const showTypes = result.packages.some((p) => p.skills.some((s) => s.type))

  console.log(`\nSkills:\n`)
  for (const pkg of result.packages) {
    console.log(`  ${pkg.name}`)
    printSkillTree(pkg.skills, { nameWidth, showTypes })
    console.log()
  }

  console.log(`Feedback:`)
  console.log(
    `  Submit feedback on skill usage to help maintainers improve the skills.`,
  )
  console.log(
    `  Load: node_modules/@tanstack/intent/meta/feedback-collection/SKILL.md`,
  )
  console.log()

  if (result.warnings.length > 0) {
    console.log(`Warnings:`)
    for (const w of result.warnings) console.log(`  ⚠ ${w}`)
  }
}

function cmdMeta(args: string[]): void {
  const metaDir = getMetaDir()

  if (!existsSync(metaDir)) {
    console.error('Meta-skills directory not found.')
    process.exit(1)
  }

  if (args.length > 0) {
    const name = args[0]!
    if (name.includes('..') || name.includes('/') || name.includes('\\')) {
      console.error(`Invalid meta-skill name: "${name}"`)
      process.exit(1)
    }
    const skillFile = join(metaDir, name, 'SKILL.md')
    if (!existsSync(skillFile)) {
      console.error(`Meta-skill "${name}" not found.`)
      console.error(
        `Run \`npx @tanstack/intent meta\` to list available meta-skills.`,
      )
      process.exit(1)
    }
    try {
      console.log(readFileSync(skillFile, 'utf8'))
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`Failed to read meta-skill "${name}": ${msg}`)
      process.exit(1)
    }
    return
  }

  const entries = readdirSync(metaDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .filter((e) => existsSync(join(metaDir, e.name, 'SKILL.md')))

  if (entries.length === 0) {
    console.log('No meta-skills found.')
    return
  }

  console.log('Meta-skills (for library maintainers):\n')

  for (const entry of entries) {
    const skillFile = join(metaDir, entry.name, 'SKILL.md')
    const fm = parseFrontmatter(skillFile)
    let description = ''
    if (typeof fm?.description === 'string') {
      description = fm.description.replace(/\s+/g, ' ').trim()
    }

    const shortDesc =
      description.length > 60 ? description.slice(0, 57) + '...' : description
    console.log(`  ${entry.name.padEnd(28)} ${shortDesc}`)
  }

  console.log(`\nUsage: load the SKILL.md into your AI agent conversation.`)
  console.log(`Path: node_modules/@tanstack/intent/meta/<name>/SKILL.md`)
}

function collectPackagingWarnings(root: string): string[] {
  const pkgJsonPath = join(root, 'package.json')
  if (!existsSync(pkgJsonPath)) return []

  let pkgJson: Record<string, unknown>
  try {
    pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return [`Could not parse package.json: ${msg}`]
  }

  const warnings: string[] = []

  const devDeps = pkgJson.devDependencies as Record<string, string> | undefined
  if (!devDeps?.['@tanstack/intent']) {
    warnings.push('@tanstack/intent is not in devDependencies')
  }

  const bin = pkgJson.bin as Record<string, string> | undefined
  if (!bin?.intent) {
    warnings.push('Missing "bin": { "intent": ... } entry in package.json')
  }

  const shimJs = join(root, 'bin', 'intent.js')
  const shimMjs = join(root, 'bin', 'intent.mjs')
  if (!existsSync(shimJs) && !existsSync(shimMjs)) {
    warnings.push(
      'No bin/intent.js or bin/intent.mjs shim found (run: npx @tanstack/intent add-library-bin)',
    )
  }

  const files = pkgJson.files as string[] | undefined
  if (Array.isArray(files)) {
    if (!files.includes('skills')) {
      warnings.push(
        '"skills" is not in the "files" array — skills won\'t be published',
      )
    }
    if (!files.includes('bin')) {
      warnings.push(
        '"bin" is not in the "files" array — shim won\'t be published',
      )
    }
    if (!files.includes('!skills/_artifacts')) {
      warnings.push(
        '"!skills/_artifacts" is not in the "files" array — artifacts will be published unnecessarily',
      )
    }
  }

  return warnings
}

function cmdValidate(args: string[]): void {
  const targetDir = args[0] ?? 'skills'
  const skillsDir = join(process.cwd(), targetDir)

  if (!existsSync(skillsDir)) {
    console.error(`Skills directory not found: ${skillsDir}`)
    process.exit(1)
  }

  interface ValidationError {
    file: string
    message: string
  }

  const errors: ValidationError[] = []
  const skillFiles = findSkillFiles(skillsDir)

  if (skillFiles.length === 0) {
    console.error('No SKILL.md files found')
    process.exit(1)
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
    } catch {
      errors.push({ file: rel, message: 'Invalid YAML frontmatter' })
      continue
    }

    if (!fm.name)
      errors.push({ file: rel, message: 'Missing required field: name' })
    if (!fm.description)
      errors.push({ file: rel, message: 'Missing required field: description' })

    // Validate name matches directory path
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

    // Description character limit
    if (typeof fm.description === 'string' && fm.description.length > 1024) {
      errors.push({
        file: rel,
        message: `Description exceeds 1024 character limit (${fm.description.length} chars)`,
      })
    }

    // Framework skills must have requires
    if (fm.type === 'framework' && !Array.isArray(fm.requires)) {
      errors.push({
        file: rel,
        message: 'Framework skills must have a "requires" field',
      })
    }

    // Line count
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
        } catch {
          errors.push({
            file: relative(process.cwd(), artifactPath),
            message: 'Invalid YAML in artifact file',
          })
        }
      }
    }
  }

  const warnings = collectPackagingWarnings(process.cwd())

  const printWarnings = (log: (...args: unknown[]) => void): void => {
    if (warnings.length === 0) return
    log(`\n⚠ Packaging warnings:`)
    for (const w of warnings) log(`  ${w}`)
  }

  if (errors.length > 0) {
    console.error(`\n❌ Validation failed with ${errors.length} error(s):\n`)
    for (const { file, message } of errors) {
      console.error(`  ${file}: ${message}`)
    }
    printWarnings(console.error)
    process.exit(1)
  }

  console.log(`✅ Validated ${skillFiles.length} skill files — all passed`)
  printWarnings(console.log)
}

function cmdScaffold(): void {
  const metaDir = getMetaDir()
  const metaSkillPath = (name: string) => join(metaDir, name, 'SKILL.md')

  const prompt = `You are helping a library maintainer scaffold Intent skills.

Run the three meta skills below **one at a time, in order**. For each step:
1. Load the SKILL.md file specified
2. Follow its instructions completely
3. Present outputs to the maintainer for review
4. Do NOT proceed to the next step until the maintainer confirms

## Before you start

Gather this context yourself (do not ask the maintainer — agents should never
ask for information they can discover):
1. Read package.json for library name, repository URL, and homepage/docs URL
2. Detect if this is a monorepo (look for workspaces field, packages/ directory, lerna.json)
3. Use skills/ as the default skills root
4. For monorepos:
   - Domain map artifacts go at the REPO ROOT: _artifacts/
   - Skills go INSIDE EACH PACKAGE: packages/<pkg>/skills/
   - Identify which packages are client-facing (usually client SDKs and primary framework adapters)

---

## Step 1 — Domain Discovery

Load and follow: ${metaSkillPath('domain-discovery')}

This produces: domain_map.yaml and skill_spec.md in the artifacts directory.
Domain discovery covers the WHOLE library (one domain map even for monorepos).

**STOP. Review outputs with the maintainer before continuing.**

---

## Step 2 — Tree Generator

Load and follow: ${metaSkillPath('tree-generator')}

This produces: skill_tree.yaml in the artifacts directory.
For monorepos, each skill entry should include a \`package\` field.

**STOP. Review outputs with the maintainer before continuing.**

---

## Step 3 — Generate Skills

Load and follow: ${metaSkillPath('generate-skill')}

This produces: individual SKILL.md files.
- Single-repo: skills/<domain>/<skill>/SKILL.md
- Monorepo: packages/<pkg>/skills/<domain>/<skill>/SKILL.md

---

## After all skills are generated

1. Run \`npx @tanstack/intent validate\` in each package directory
2. Commit skills/ and artifacts
3. For each publishable package, run: \`npx @tanstack/intent add-library-bin\`
4. For each publishable package, run: \`npx @tanstack/intent edit-package-json\`
5. Ensure each package has \`@tanstack/intent\` as a devDependency
6. Create a \`skill:<skill-name>\` label on the GitHub repo for each skill (use \`gh label create\`)
7. Add a README note: "If you use an AI agent, run \`npx @tanstack/intent@latest install\`"
`

  console.log(prompt)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const USAGE = `TanStack Intent CLI

Usage:
  intent list [--json]           Discover intent-enabled packages
  intent meta [name]             List meta-skills, or print one by name
  intent validate [<dir>]        Validate skill files (default: skills/)
  intent install                  Print a skill that guides your coding agent to set up skill-to-task mappings
  intent scaffold                Print maintainer scaffold prompt
  intent add-library-bin         Generate bin/intent.{js,mjs} bridge file
  intent edit-package-json       Wire package.json (files, bin) for skill publishing
  intent setup-github-actions    Copy CI workflow templates to .github/workflows/
  intent stale                   Check skills for staleness`

const command = process.argv[2]
const commandArgs = process.argv.slice(3)

switch (command) {
  case 'list':
    await cmdList(commandArgs)
    break
  case 'meta':
    cmdMeta(commandArgs)
    break
  case 'validate':
    cmdValidate(commandArgs)
    break
  case 'install': {
    const prompt = `You are an AI assistant helping a developer set up skill-to-task mappings for their project.

Follow these steps in order:

1. CHECK FOR EXISTING MAPPINGS
   Search the project's agent config files (CLAUDE.md, AGENTS.md, .cursorrules,
   .github/copilot-instructions.md) for a block delimited by:
     <!-- intent-skills:start -->
     <!-- intent-skills:end -->
   - If found: show the user the current mappings and ask "What would you like to update?"
     Then skip to step 4 with their requested changes.
   - If not found: continue to step 2.

2. DISCOVER AVAILABLE SKILLS
   Run: intent list
   This outputs each skill's name, description, and full path — grouped by package.

3. SCAN THE REPOSITORY
   Build a picture of the project's structure and patterns:
   - Read package.json for library dependencies
   - Survey the directory layout (src/, app/, routes/, components/, api/, etc.)
   - Note recurring patterns (routing, data fetching, auth, UI components, etc.)

   Based on this, propose 3–5 skill-to-task mappings. For each one explain:
   - The task or code area (in plain language the user would recognise)
   - Which skill applies and why

   Then ask: "What other tasks do you commonly use AI coding agents for?
   I'll create mappings for those too."

4. WRITE THE MAPPINGS BLOCK
   Once you have the full set of mappings, write or update the agent config file
   (prefer CLAUDE.md; create it if none exists) with this exact block:

<!-- intent-skills:start -->
# Skill mappings — when working in these areas, load the linked skill file into context.
skills:
  - task: "describe the task or code area here"
    load: "node_modules/package-name/skills/skill-name/SKILL.md"
<!-- intent-skills:end -->

   Rules:
   - Use the user's own words for task descriptions
   - Include the exact path from \`intent list\` output so agents can load it directly
   - Keep entries concise — this block is read on every agent task
   - Preserve all content outside the block tags unchanged`

    console.log(prompt)
    break
  }
  case 'scaffold': {
    cmdScaffold()
    break
  }
  case 'stale': {
    const { checkStaleness } = await import('./staleness.js')
    const { scanForIntents: scanStale } = await import('./scanner.js')
    let staleResult
    try {
      staleResult = await scanStale()
    } catch (err) {
      console.error((err as Error).message)
      process.exit(1)
    }

    if (staleResult.packages.length === 0) {
      console.log('No intent-enabled packages found.')
      break
    }

    const jsonStale = commandArgs.includes('--json')
    const reports = await Promise.all(
      staleResult.packages.map((pkg) => {
        const pkgDir = join(process.cwd(), 'node_modules', pkg.name)
        return checkStaleness(pkgDir, pkg.name)
      }),
    )

    if (jsonStale) {
      console.log(JSON.stringify(reports, null, 2))
      break
    }

    for (const report of reports) {
      const driftLabel = report.versionDrift
        ? ` [${report.versionDrift} drift]`
        : ''
      const vLabel =
        report.skillVersion && report.currentVersion
          ? ` (${report.skillVersion} → ${report.currentVersion})`
          : ''
      console.log(`${report.library}${vLabel}${driftLabel}`)

      const stale = report.skills.filter((s) => s.needsReview)
      if (stale.length === 0) {
        console.log('  All skills up-to-date')
      } else {
        for (const skill of stale) {
          console.log(`  ⚠ ${skill.name}: ${skill.reasons.join(', ')}`)
        }
      }
      console.log()
    }
    break
  }
  case 'add-library-bin': {
    const { runAddLibraryBin } = await import('./setup.js')
    runAddLibraryBin(process.cwd())
    break
  }
  case 'edit-package-json': {
    const { runEditPackageJson } = await import('./setup.js')
    runEditPackageJson(process.cwd())
    break
  }
  case 'setup-github-actions': {
    const { runSetupGithubActions } = await import('./setup.js')
    runSetupGithubActions(process.cwd(), getMetaDir())
    break
  }
  default:
    console.log(USAGE)
    process.exit(command ? 1 : 0)
}
