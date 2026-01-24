import { existsSync } from 'node:fs'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const repoRoot = resolve(__dirname, '..')

const manifestArg = process.argv[2]

if (!manifestArg) {
  throw new Error(
    'Usage: node scripts/update-skills-manifest.mjs <path/to/manifest.json>',
  )
}

const manifestPath = resolve(repoRoot, manifestArg)
const packageRoot = resolve(manifestPath, '..')
const skillsRoot = resolve(packageRoot, 'skills')

const manifest = JSON.parse(await readFile(manifestPath, 'utf-8'))

const versionDirs = (await readdir(skillsRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && entry.name.startsWith('v'))
  .map((entry) => entry.name)
  .sort()

if (versionDirs.length === 0) {
  throw new Error(`No versioned skill directories found under ${skillsRoot}.`)
}

const versions = {}
const versionFiles = new Map()

for (const version of versionDirs) {
  const versionRoot = resolve(skillsRoot, version)
  const files = (await readdir(versionRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort()

  if (files.length === 0) {
    throw new Error(`No markdown skills found for ${version}.`)
  }

  versionFiles.set(version, files)

  const defaultIndex = `skills/${version}/index.md`
  const fallbackIndex = manifest.versions?.[version]?.index
  const index = existsSync(resolve(packageRoot, defaultIndex))
    ? defaultIndex
    : fallbackIndex

  if (!index) {
    throw new Error(`No index found for ${version}.`)
  }

  versions[version] = {
    index,
    files: files.map((file) => `skills/${version}/${file}`),
  }
}

const nextManifest = {
  ...manifest,
  versions,
}

await writeFile(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`)

if (manifest.topics) {
  const latestVersion = versionDirs[versionDirs.length - 1]
  const files = versionFiles.get(latestVersion) ?? []
  const sortedTopics = files
    .map((file) => basename(file))
    .sort((a, b) => {
      if (a === 'index.md') return -1
      if (b === 'index.md') return 1
      return a.localeCompare(b)
    })

  const topicsPath = resolve(packageRoot, manifest.topics)
  await writeFile(topicsPath, `${JSON.stringify(sortedTopics, null, 2)}\n`)
  console.log(`Updated topics list: ${topicsPath}`)
}

console.log(`Updated skills manifest: ${manifestPath}`)
