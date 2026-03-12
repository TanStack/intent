// @ts-nocheck

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execSync } from 'node:child_process'

const rootDir = path.resolve(import.meta.dirname, '..')
const packagesDir = path.join(rootDir, 'packages')
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
const isPrerelease = process.argv.includes('--prerelease')

function run(command, options = {}) {
  return execSync(command, {
    cwd: rootDir,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    ...options,
  }).trim()
}

function maybeRun(command) {
  try {
    return run(command)
  } catch {
    return null
  }
}

function getReleaseCommits() {
  const output = maybeRun(
    'git log --grep="ci: changeset release" --format=%H --no-merges',
  )

  if (!output) {
    return []
  }

  return output.split('\n').filter(Boolean)
}

function getPackages() {
  return fs
    .readdirSync(packagesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const dir = entry.name
      const packageJsonPath = path.join(packagesDir, dir, 'package.json')
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))

      return {
        dir,
        packageJsonPath,
        packageJson,
      }
    })
    .filter(({ packageJson }) => !packageJson.private)
}

function getPreviousPackageJson(releaseCommit, packageJsonPath) {
  if (!releaseCommit) {
    return null
  }

  const relativePath = path.relative(rootDir, packageJsonPath)
  const content = maybeRun(`git show ${releaseCommit}:'${relativePath}'`)

  if (!content) {
    return null
  }

  return JSON.parse(content)
}

function getChangedPackages(previousReleaseCommit) {
  return getPackages()
    .map(({ dir, packageJsonPath, packageJson }) => {
      const previousPackageJson = getPreviousPackageJson(
        previousReleaseCommit,
        packageJsonPath,
      )

      if (
        !previousPackageJson ||
        previousPackageJson.version !== packageJson.version
      ) {
        return {
          dir,
          name: packageJson.name,
          version: packageJson.version,
          previousVersion: previousPackageJson?.version ?? null,
        }
      }

      return null
    })
    .filter(Boolean)
    .sort((left, right) => left.name.localeCompare(right.name))
}

function getChangelogSection(changelogPath, version) {
  if (!fs.existsSync(changelogPath)) {
    return null
  }

  const changelog = fs.readFileSync(changelogPath, 'utf8')
  const marker = `## ${version}`
  const start = changelog.indexOf(marker)

  if (start === -1) {
    return null
  }

  const bodyStart = changelog.indexOf('\n', start)
  const nextSection = changelog.indexOf('\n## ', bodyStart + 1)

  return changelog
    .slice(bodyStart + 1, nextSection === -1 ? undefined : nextSection)
    .trim()
}

function buildReleaseNotes(changedPackages) {
  const sections = changedPackages.map((pkg) => {
    const changelogPath = path.join(packagesDir, pkg.dir, 'CHANGELOG.md')
    const content =
      getChangelogSection(changelogPath, pkg.version) ||
      '- No changelog entries'

    return `#### ${pkg.name}\n\n${content}`
  })

  return sections.join('\n\n')
}

function createReleaseTag() {
  const now = new Date().toISOString()
  const tag = `release-${now.slice(0, 10)}-${now.slice(11, 13)}${now.slice(14, 16)}`
  const title = `Release ${now.slice(0, 10)} ${now.slice(11, 16)}`

  return { tag, title }
}

function createReleaseBody(title, changedPackages, notes) {
  const packages = changedPackages
    .map((pkg) => `- ${pkg.name}@${pkg.version}`)
    .join('\n')

  return `${title}\n\n## Changes\n\n${notes}\n\n## Packages\n\n${packages}`
}

function pushTag(tag) {
  const exists = maybeRun(`git rev-parse ${tag}`)

  if (exists) {
    return false
  }

  run(`git tag -a ${tag} -m "${tag}"`)
  run(`git push origin ${tag}`)
  return true
}

function createGitHubRelease(tag, title, body) {
  if (!token) {
    throw new Error('Missing GH_TOKEN or GITHUB_TOKEN')
  }

  const notesFile = path.join(os.tmpdir(), `${tag}.md`)
  fs.writeFileSync(notesFile, body)

  const args = [
    'gh',
    'release',
    'create',
    tag,
    '--title',
    JSON.stringify(title),
    '--notes-file',
    JSON.stringify(notesFile),
  ]

  if (isPrerelease) {
    args.push('--prerelease')
  } else {
    args.push('--latest')
  }

  try {
    execSync(args.join(' '), {
      cwd: rootDir,
      stdio: 'inherit',
      env: {
        ...process.env,
        GH_TOKEN: token,
        GITHUB_TOKEN: token,
      },
    })
  } finally {
    fs.rmSync(notesFile, { force: true })
  }
}

function rollbackTag(tag) {
  maybeRun(`git push --delete origin ${tag}`)
  maybeRun(`git tag -d ${tag}`)
}

function main() {
  const [, previousReleaseCommit] = getReleaseCommits()
  const changedPackages = getChangedPackages(previousReleaseCommit)

  if (changedPackages.length === 0) {
    console.log('No changed packages found for GitHub release.')
    return
  }

  const notes = buildReleaseNotes(changedPackages)
  const { tag, title } = createReleaseTag()
  const body = createReleaseBody(title, changedPackages, notes)

  let createdTag = false

  try {
    createdTag = pushTag(tag)
    createGitHubRelease(tag, title, body)
  } catch (error) {
    if (createdTag) {
      rollbackTag(tag)
    }

    throw error
  }
}

main()
