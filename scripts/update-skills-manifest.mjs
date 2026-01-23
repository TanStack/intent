import { existsSync } from 'node:fs'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
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

for (const version of versionDirs) {
  const versionRoot = resolve(skillsRoot, version)
  const files = (await readdir(versionRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name)
    .sort()

  if (files.length === 0) {
    throw new Error(`No markdown skills found for ${version}.`)
  }

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

console.log(`Updated skills manifest: ${manifestPath}`)
