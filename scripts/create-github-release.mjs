// @ts-nocheck

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execSync } from 'node:child_process'

const rootDir = path.resolve(import.meta.dirname, '..')
const packagesDir = path.join(rootDir, 'packages')
const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN
const isPrerelease = process.argv.includes('--prerelease')
const isDryRun = process.argv.includes('--dry-run')

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

function getPreviousGitHubReleaseCommit() {
  const output = maybeRun('git tag --list "release-*" --sort=-creatordate')

  if (!output) {
    return null
  }

  const [tag] = output.split('\n').filter(Boolean)

  if (!tag) {
    return null
  }

  return maybeRun(`git rev-list -n 1 ${tag}`)
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

function parseVersion(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)$/)

  if (!match) {
    return null
  }

  return match.slice(1).map(Number)
}

function compareVersions(leftVersion, rightVersion) {
  const left = parseVersion(leftVersion)
  const right = parseVersion(rightVersion)

  if (!left || !right) {
    return leftVersion.localeCompare(rightVersion)
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return left[index] - right[index]
    }
  }

  return 0
}

function isVersionInRange(version, previousVersion, currentVersion) {
  if (compareVersions(version, currentVersion) > 0) {
    return false
  }

  if (!previousVersion) {
    return true
  }

  return compareVersions(version, previousVersion) > 0
}

function getChangelogSections(changelogPath, previousVersion, currentVersion) {
  if (!fs.existsSync(changelogPath)) {
    return []
  }

  const changelog = fs.readFileSync(changelogPath, 'utf8')
  const sections = []
  const headingPattern = /^## (\d+\.\d+\.\d+)\s*$/gm
  const headings = Array.from(changelog.matchAll(headingPattern))

  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index]
    const version = heading[1]

    if (!isVersionInRange(version, previousVersion, currentVersion)) {
      continue
    }

    const nextHeading = headings[index + 1]
    const bodyStart = changelog.indexOf('\n', heading.index)
    const body = changelog.slice(bodyStart + 1, nextHeading?.index).trim()

    sections.push({
      version,
      body: body || '- No changelog entries',
    })
  }

  return sections
}

function buildReleaseNotes(changedPackages) {
  const sections = changedPackages.map((pkg) => {
    const changelogPath = path.join(packagesDir, pkg.dir, 'CHANGELOG.md')
    const changelogSections = getChangelogSections(
      changelogPath,
      pkg.previousVersion,
      pkg.version,
    )
    const content =
      changelogSections
        .map((section) => `### ${section.version}\n\n${section.body}`)
        .join('\n\n') || '- No changelog entries'

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
  const changedPackages = getChangedPackages(
    getPreviousGitHubReleaseCommit() || previousReleaseCommit,
  )

  if (changedPackages.length === 0) {
    console.log('No changed packages found for GitHub release.')
    return
  }

  const notes = buildReleaseNotes(changedPackages)
  const { tag, title } = createReleaseTag()
  const body = createReleaseBody(title, changedPackages, notes)

  if (isDryRun) {
    console.log(body)
    return
  }

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
