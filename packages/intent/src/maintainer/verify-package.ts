import { execFileSync } from 'node:child_process'
import { createReadStream, readFileSync, statSync } from 'node:fs'
import { posix, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { parseTar } from '@remix-run/tar-parser'
import { collectMarkdownDestinations } from '../core/markdown.js'
import { parseFrontmatterText } from '../shared/utils.js'
import { isObject, projectPath, skillEntries } from './project.js'
import type { MaintainerProject } from './project.js'

interface PackageProblem {
  file: string
  target?: string
  message: string
}

async function readArchive(archive: string) {
  if (statSync(archive).size > 128 * 1024 * 1024)
    throw new Error('Compressed archive exceeds the 128 MiB inspection limit.')
  const input = createReadStream(archive)
  const files = new Set<string>()
  const documents = new Map<string, string>()
  let expanded = 0
  let textBytes = 0
  let entries = 0
  const stream = (Readable.toWeb(input) as ReadableStream<BufferSource>)
    .pipeThrough(new DecompressionStream('gzip'))
    .pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          expanded += chunk.byteLength
          if (expanded > 512 * 1024 * 1024)
            throw new Error(
              'Expanded archive exceeds the 512 MiB inspection limit.',
            )
          controller.enqueue(chunk)
        },
      }),
    )
  try {
    await parseTar(stream, { allowUnknownFormat: false }, (entry) => {
      if (++entries > 50_000)
        throw new Error('Archive exceeds the 50,000-entry inspection limit.')
      const name = entry.name.replace(/^(\.\/)+/, '').replace(/\/$/, '')
      if (
        !name ||
        /[\\:]/.test(name) ||
        [...name].some(
          (character) =>
            character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        ) ||
        name
          .split('/')
          .some((part) => !part || part === '.' || part === '..') ||
        (name !== 'package' && !name.startsWith('package/'))
      )
        throw new Error(
          `Unsafe package archive path: ${JSON.stringify(entry.name)}`,
        )
      if (!['file', 'directory'].includes(entry.header.type))
        throw new Error(
          `Unsupported archive entry ${entry.header.type}: ${name}`,
        )
      if (!Number.isSafeInteger(entry.size) || entry.size < 0)
        throw new Error(`Invalid archive entry size: ${name}`)
      if (entry.header.type === 'directory') return
      const path = name.slice('package/'.length)
      if (!path || files.has(path))
        throw new Error(`Duplicate or invalid package file: ${name}`)
      files.add(path)
      if (path !== 'package.json' && !path.endsWith('.md'))
        return entry.body.pipeTo(new WritableStream())
      textBytes += entry.size
      if (entry.size > 4 * 1024 * 1024 || textBytes > 32 * 1024 * 1024)
        throw new Error(
          'Package text exceeds the 4 MiB file or 32 MiB total inspection limit.',
        )
      return entry.text().then((content) => {
        documents.set(path, content)
      })
    })
  } finally {
    input.destroy()
  }
  return { files, documents }
}

export async function verifyPackageArchive(
  project: MaintainerProject,
  archive: string,
  packageDirectory = '',
) {
  if (packageDirectory === '.') packageDirectory = ''
  const manifestPath = projectPath(
    project.root,
    packageDirectory ? `${packageDirectory}/package.json` : 'package.json',
  )
  const manifest: unknown = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (!isObject(manifest) || typeof manifest.name !== 'string')
    throw new Error('The selected package needs a valid package.json name.')
  const registered = skillEntries(project).filter(
    (entry) =>
      (entry.package ?? '') === packageDirectory &&
      !['planned', 'retired'].includes(String(entry.status)),
  )
  const problems: Array<PackageProblem> = []
  const skills = registered.map((entry) => entry.path)
  if (!skills.length)
    problems.push({
      file: 'skill_tree.yaml',
      message: 'No active skills are registered for the selected package.',
    })
  const archivePath = resolve(archive)
  try {
    const { files, documents } = await readArchive(archivePath)
    const packedManifest: unknown = JSON.parse(
      documents.get('package.json') ?? 'null',
    )
    if (
      !isObject(packedManifest) ||
      packedManifest.name !== manifest.name ||
      packedManifest.version !== manifest.version
    )
      problems.push({
        file: 'package.json',
        message:
          'Archive name and version must match the selected source package.',
      })
    const sourceFiles = skills.length
      ? execFileSync(
          'git',
          [
            '-c',
            'core.fsmonitor=false',
            '--literal-pathspecs',
            'ls-files',
            '--cached',
            '--others',
            '--exclude-standard',
            '-z',
            '--',
            ...skills.map((skill) =>
              posix.join(packageDirectory, posix.dirname(skill)),
            ),
          ],
          { cwd: project.root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
        )
          .split('\0')
          .filter(Boolean)
      : []
    const resources = sourceFiles.map((file) =>
      packageDirectory ? file.slice(packageDirectory.length + 1) : file,
    )
    for (const resource of resources) {
      if (files.has(resource) || skills.includes(resource)) continue
      problems.push({
        file: skills.find((skill) =>
          resource.startsWith(`${posix.dirname(skill)}/`),
        )!,
        target: resource,
        message: 'Skill-folder resource is missing from the archive.',
      })
    }
    const pending = [
      ...skills,
      ...resources.filter((file) => file.endsWith('.md')),
    ]
    const visited = new Set<string>()
    for (const entry of registered) {
      const content = documents.get(entry.path)
      const frontmatter =
        content === undefined ? null : parseFrontmatterText(content)
      if (!frontmatter || frontmatter.name !== (entry.slug ?? entry.name))
        problems.push({
          file: entry.path,
          message:
            'Registered skill is missing or has a different identity in the archive.',
        })
    }
    for (const file of pending) {
      if (visited.has(file)) continue
      visited.add(file)
      const content = documents.get(file)
      if (content === undefined) continue
      const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, '')
      for (const destination of collectMarkdownDestinations(body)) {
        if (
          !destination ||
          /^[#?]/.test(destination) ||
          destination.startsWith('//')
        )
          continue
        if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(destination)) continue
        const path = decodeURIComponent(destination.split(/[?#]/)[0]!).replace(
          /\\([!"#$%&'()*+,\-./:;<=>?@[\]^_`{|}~\\])/g,
          '$1',
        )
        const target = posix.normalize(posix.join(posix.dirname(file), path))
        if (
          path.startsWith('/') ||
          target === '..' ||
          target.startsWith('../') ||
          target.includes('\\')
        ) {
          problems.push({
            file,
            target: destination,
            message: 'Reference leaves the installed package.',
          })
          continue
        }
        if (!files.has(target)) {
          problems.push({
            file,
            target,
            message: 'Required reference is missing from the archive.',
          })
          continue
        }
        if (target.endsWith('.md')) pending.push(target)
      }
    }
  } catch (error) {
    problems.push({
      file: archivePath,
      message: error instanceof Error ? error.message : String(error),
    })
  }
  return {
    schemaVersion: 1,
    archive: archivePath,
    package: { name: manifest.name, version: manifest.version },
    skills,
    problems,
    valid: problems.length === 0,
  }
}
