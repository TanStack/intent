#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'
import { scanForIntents } from './scanner.js'
import type { ScanResult } from './types.js'
import { findSkillFiles, parseFrontmatter } from './utils.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getMetaDir(): string {
  // Resolve relative to this file's location in dist/
  const thisDir = dirname(fileURLToPath(import.meta.url))
  return join(thisDir, '..', 'meta')
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function padColumn(text: string, width: number): string {
  return text.length >= width ? text + '  ' : text.padEnd(width)
}

function printTable(headers: string[], rows: string[][]): void {
  const widths = headers.map(
    (h, i) => Math.max(h.length, ...rows.map((r) => (r[i] ?? '').length)) + 2,
  )

  const headerLine = headers.map((h, i) => padColumn(h, widths[i]!)).join('')
  const separator = widths.map((w) => '─'.repeat(w)).join('')

  console.log(headerLine)
  console.log(separator)
  for (const row of rows) {
    console.log(row.map((cell, i) => padColumn(cell, widths[i]!)).join(''))
  }
}

interface SkillDisplay {
  name: string
  description: string
  type?: string
  path?: string
}

function printSkillTree(
  skills: SkillDisplay[],
  opts: { nameWidth: number; showTypes: boolean },
): void {
  const roots: string[] = []
  const children = new Map<string, SkillDisplay[]>()

  for (const skill of skills) {
    const slashIdx = skill.name.indexOf('/')
    if (slashIdx === -1) {
      roots.push(skill.name)
    } else {
      const parent = skill.name.slice(0, slashIdx)
      if (!children.has(parent)) children.set(parent, [])
      children.get(parent)!.push(skill)
    }
  }

  if (roots.length === 0) {
    for (const skill of skills) {
      if (!roots.includes(skill.name)) roots.push(skill.name)
    }
  }

  for (const rootName of roots) {
    const rootSkill = skills.find((s) => s.name === rootName)
    if (!rootSkill) continue

    printSkillLine(rootName, rootSkill, 4, opts)

    for (const sub of children.get(rootName) ?? []) {
      const childName = sub.name.slice(sub.name.indexOf('/') + 1)
      printSkillLine(childName, sub, 6, opts)
    }
  }
}

function printSkillLine(
  displayName: string,
  skill: SkillDisplay,
  indent: number,
  opts: { nameWidth: number; showTypes: boolean },
): void {
  const nameStr = ' '.repeat(indent) + displayName
  const padding = ' '.repeat(Math.max(2, opts.nameWidth - nameStr.length))
  const typeCol = opts.showTypes
    ? (skill.type ? `[${skill.type}]` : '').padEnd(14)
    : ''
  console.log(`${nameStr}${padding}${typeCol}${skill.description}`)
  if (skill.path) {
    console.log(`${' '.repeat(indent + 2)}${skill.path}`)
  }
}

function computeSkillNameWidth(allPackageSkills: SkillDisplay[][]): number {
  let max = 0
  for (const skills of allPackageSkills) {
    for (const s of skills) {
      const slashIdx = s.name.indexOf('/')
      const displayName = slashIdx === -1 ? s.name : s.name.slice(slashIdx + 1)
      const indent = slashIdx === -1 ? 4 : 6
      max = Math.max(max, indent + displayName.length)
    }
  }
  return max + 2
}

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
  console.log(`  After completing your task, collect feedback on skill usage.`)
  console.log(
    `  Instructions: node_modules/@tanstack/intent/meta/feedback-collection/SKILL.md`,
  )
  console.log(
    `  Submit: npx intent feedback --submit --file intent-feedback.json`,
  )
  console.log()

  if (result.warnings.length > 0) {
    console.log(`Warnings:`)
    for (const w of result.warnings) console.log(`  ⚠ ${w}`)
  }
}

function cmdMeta(): void {
  const metaDir = getMetaDir()

  if (!existsSync(metaDir)) {
    console.error('Meta-skills directory not found.')
    process.exit(1)
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

  // Packaging checks — run when package.json exists at cwd
  const pkgJsonPath = join(process.cwd(), 'package.json')
  const warnings: string[] = []
  if (existsSync(pkgJsonPath)) {
    let pkgJson: Record<string, unknown> = {}
    try {
      pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'))
    } catch {
      // skip packaging checks if we can't read package.json
    }

    if (Object.keys(pkgJson).length > 0) {
      // Check @tanstack/intent in devDependencies
      const devDeps = pkgJson.devDependencies as
        | Record<string, string>
        | undefined
      if (!devDeps?.['@tanstack/intent']) {
        warnings.push('@tanstack/intent is not in devDependencies')
      }

      // Check bin entry
      const bin = pkgJson.bin as Record<string, string> | undefined
      if (!bin?.intent) {
        warnings.push('Missing "bin": { "intent": ... } entry in package.json')
      }

      // Check shim file exists
      const shimJs = join(process.cwd(), 'bin', 'intent.js')
      const shimMjs = join(process.cwd(), 'bin', 'intent.mjs')
      if (!existsSync(shimJs) && !existsSync(shimMjs)) {
        warnings.push(
          'No bin/intent.js or bin/intent.mjs shim found (run: npx @tanstack/intent setup --shim)',
        )
      }

      // Check files array
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
    }
  }

  if (errors.length > 0) {
    console.error(`\n❌ Validation failed with ${errors.length} error(s):\n`)
    for (const { file, message } of errors) {
      console.error(`  ${file}: ${message}`)
    }
    if (warnings.length > 0) {
      console.error(`\n⚠ Packaging warnings:`)
      for (const w of warnings) console.error(`  ${w}`)
    }
    process.exit(1)
  }

  console.log(`✅ Validated ${skillFiles.length} skill files — all passed`)
  if (warnings.length > 0) {
    console.log(`\n⚠ Packaging warnings:`)
    for (const w of warnings) console.log(`  ${w}`)
  }
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
3. For each publishable package, run: \`npx @tanstack/intent setup --shim\`
4. Ensure each package has \`@tanstack/intent\` as a devDependency
5. Add \`"skills"\`, \`"bin"\` to the \`"files"\` array in each package.json
6. Add \`"!skills/_artifacts"\` to exclude artifacts from publishing
7. Run \`npx @tanstack/intent setup --labels\` to create feedback labels on the GitHub repo
8. Add a README note: "If you use an AI agent, run \`npx @tanstack/intent init\`"
`

  console.log(prompt)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const USAGE = `TanStack Intent CLI

Usage:
  intent list [--json]           Discover intent-enabled packages
  intent meta                    List meta-skills for maintainers
  intent validate [<dir>]        Validate skill files (default: skills/)
  intent init                    Set up intent discovery in agent configs
  intent scaffold                Print maintainer scaffold prompt
  intent setup [--workflows] [--shim] [--labels] [--all]  Copy CI templates, generate shim, create labels
  intent stale                   Check skills for staleness
  intent feedback --submit --file <path>           Submit skill feedback
  intent feedback --meta --submit --file <path>    Submit meta-skill feedback`

const command = process.argv[2]
const commandArgs = process.argv.slice(3)

switch (command) {
  case 'list':
    await cmdList(commandArgs)
    break
  case 'meta':
    cmdMeta()
    break
  case 'validate':
    cmdValidate(commandArgs)
    break
  case 'init': {
    const { runInit, detectAgentConfigs } = await import('./init.js')
    const initRoot = process.cwd()
    const result = runInit(initRoot)

    for (const f of result.injected) console.log(`✓ Added intent block to ${f}`)
    for (const f of result.skipped) console.log(`  Already present in ${f}`)
    for (const f of result.created) console.log(`✓ Created ${f}`)

    if (result.injected.length === 0 && result.skipped.length === 0) {
      const detected = detectAgentConfigs(initRoot)
      if (detected.length === 0) {
        console.log(
          'No agent config files found (AGENTS.md, CLAUDE.md, .cursorrules, .github/copilot-instructions.md).',
        )
        console.log('Create one of these files and run intent init again.')
      }
    }

    console.log(`✓ Config: ${result.configPath}`)
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
  case 'feedback': {
    const { runFeedback } = await import('./feedback.js')
    runFeedback(commandArgs)
    break
  }
  case 'setup': {
    const { runSetup } = await import('./setup.js')
    runSetup(process.cwd(), getMetaDir(), commandArgs)
    break
  }
  default:
    console.log(USAGE)
    process.exit(command ? 1 : 0)
}
