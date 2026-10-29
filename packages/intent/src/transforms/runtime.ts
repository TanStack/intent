import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { parse } from 'yaml'
import { nodeReadFs } from '../shared/utils.js'
import type { ReadFs } from '../shared/utils.js'
import type { TransformAnswer, TransformCommands } from './types.js'

const MAX_BYTES = 4 * 1024 * 1024
const MAX_FILES = 512
type Files = Record<string, string>

export interface TransformDeclaration {
  entry: string
  api: 1
}

function validTransformPath(path: string): boolean {
  return (
    !!path &&
    !/[\\\0:]/.test(path) &&
    path.split('/').every((part) => !!part && part !== '.' && part !== '..')
  )
}

export function readTransformDeclaration(
  content: string,
): TransformDeclaration | undefined {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
  if (!match) return undefined
  const fields = parse(match[1]!) as Record<string, unknown> | null
  const declaration = fields?.['intent-transform']
  if (declaration === undefined) return undefined
  if (
    !declaration ||
    typeof declaration !== 'object' ||
    Array.isArray(declaration)
  )
    throw new Error('intent-transform must be a mapping with entry and api: 1')
  const { entry, api } = declaration as Record<string, unknown>
  if (
    typeof entry !== 'string' ||
    !validTransformPath(entry.replace(/^\.\//, '')) ||
    api !== 1
  )
    throw new Error(
      'intent-transform requires a skill-relative entry and api: 1',
    )
  return { entry: entry.replace(/^\.\//, ''), api }
}

/** Snapshot through Intent's read adapter, including Yarn PnP archive files. */
function snapshot(root: string, fs: ReadFs = nodeReadFs): Files {
  const files: Files = Object.create(null)
  let bytes = 0
  function visit(dir: string, prefix: string) {
    for (const name of fs.readdirSync(dir).sort()) {
      const key = prefix + name
      if (!validTransformPath(key))
        throw new Error(`Invalid transform file path: ${key}`)
      const path = join(dir, name)
      const stat = fs.lstatSync(path)
      if (stat.isSymbolicLink())
        throw new Error(`Transform files must not be symbolic links: ${key}`)
      if (stat.isDirectory()) visit(path, key + '/')
      else if (stat.isFile()) {
        bytes += stat.size
        if (bytes > MAX_BYTES || Object.keys(files).length >= MAX_FILES)
          throw new Error('Transform filesystem exceeds 4 MiB or 512 files')
        files[key] = fs.readFileSync(path, 'utf8')
      } else throw new Error(`Transform files must be regular files: ${key}`)
    }
  }
  if (fs.existsSync(root)) visit(root, '')
  return files
}

// Config is consumer-owned. Reject symlinks in every component before writing.
function ensureDirectory(path: string): void {
  const absolute = resolve(path)
  const parent = dirname(absolute)
  if (parent !== absolute) ensureDirectory(parent)
  if (!existsSync(absolute)) {
    // lstat detects dangling symlinks that existsSync intentionally misses.
    try {
      if (lstatSync(absolute).isSymbolicLink())
        throw new Error(`Config path is a symbolic link: ${absolute}`)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    mkdirSync(absolute)
  }
  const stat = lstatSync(absolute)
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error(
      `Config path must be a directory without symbolic links: ${absolute}`,
    )
}

function validateFiles(value: unknown): asserts value is Files {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid transform config output')
  let bytes = 0
  const entries = Object.entries(value)
  if (entries.length > MAX_FILES)
    throw new Error('Too many transform config files')
  for (const [name, content] of entries) {
    if (!validTransformPath(name) || typeof content !== 'string')
      throw new Error('Invalid transform config file')
    bytes += Buffer.byteLength(content)
    if (bytes > MAX_BYTES) throw new Error('Transform config exceeds 4 MiB')
  }
}

function commitConfig(configDir: string, files: Files): void {
  const stage = `${configDir}.stage-${randomUUID()}`
  const backup = `${configDir}.backup-${randomUUID()}`
  mkdirSync(stage)
  let backedUp = false
  try {
    for (const [name, text] of Object.entries(files)) {
      const target = join(stage, ...name.split('/'))
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, text, 'utf8')
    }
    if (existsSync(configDir)) {
      renameSync(configDir, backup)
      backedUp = true
    }
    try {
      renameSync(stage, configDir)
    } catch (error) {
      if (backedUp) renameSync(backup, configDir)
      throw error
    }
  } finally {
    rmSync(stage, { recursive: true, force: true })
  }
  if (backedUp) rmSync(backup, { recursive: true, force: true })
}

export function runTransform(options: {
  skillDir: string
  configDir: string
  declaration: TransformDeclaration
  operation: 'load' | 'configure'
  commands: TransformCommands
  answers?: Array<TransformAnswer>
  args?: Array<string>
  reset?: boolean
  stdin?: string
  readFs?: ReadFs
}): string {
  const [major, minor] = process.versions.node.split('.').map(Number)
  if (major! < 22)
    throw new Error('Skill transforms require Node.js 22 or newer')
  if (Buffer.byteLength(options.stdin ?? '') > MAX_BYTES)
    throw new Error('Transform stdin exceeds 4 MiB')
  const skill = snapshot(options.skillDir, options.readFs)
  const code = skill[options.declaration.entry]
  if (code === undefined)
    throw new Error(`Transform entry not found: ${options.declaration.entry}`)
  ensureDirectory(dirname(options.configDir))
  // Serialize load/configure across processes. Never steal a potentially live lock.
  const lock = `${options.configDir}.lock`
  try {
    mkdirSync(lock)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST')
      throw new Error(
        `Skill configuration is busy; retry later. If a runner crashed, remove ${lock}`,
      )
    throw error
  }
  try {
    if (
      existsSync(options.configDir) ||
      (() => {
        try {
          lstatSync(options.configDir)
          return true
        } catch {
          return false
        }
      })()
    )
      ensureDirectory(options.configDir)
    const config = options.reset ? {} : snapshot(options.configDir)
    const input = JSON.stringify({
      skill,
      config,
      code,
      operation: options.operation,
      commands: options.commands,
      answers: options.answers ?? [],
      args: options.args ?? [],
      stdin: options.stdin ?? '',
    })
    if (Buffer.byteLength(input) > MAX_BYTES * 4)
      throw new Error('Transform input exceeds 16 MiB')
    const child = spawnSync(
      process.execPath,
      [
        major === 22 && minor! < 13
          ? '--experimental-permission'
          : '--permission',
        '--experimental-vm-modules',
        '--disable-proto=throw',
        '--max-old-space-size=64',
        '--no-warnings',
        '--input-type=module',
      ],
      {
        // Send the bundled worker and its input through stdin, avoiding both
        // filesystem grants and platform command-line length limits.
        input:
          `globalThis.__intentTransformInput = ${JSON.stringify(input)};\n` +
          readFileSync(
            new URL(import.meta.resolve('#transform-worker')),
            'utf8',
          ),
        encoding: 'utf8',
        env: {},
        timeout: 5000,
        killSignal: 'SIGKILL',
        maxBuffer: MAX_BYTES * 4,
        windowsHide: true,
      },
    )
    if (child.error) throw new Error(`Transform failed: ${child.error.message}`)
    if (child.status !== 0)
      throw new Error(
        `Transform failed: ${child.stderr.trim() || child.signal || child.status}`,
      )
    const output = JSON.parse(child.stdout) as {
      content?: unknown
      files?: unknown
    }
    if (
      typeof output.content !== 'string' ||
      Buffer.byteLength(output.content) > MAX_BYTES
    )
      throw new Error('Transform must return a string of at most 4 MiB')
    validateFiles(output.files)
    if (options.reset || JSON.stringify(config) !== JSON.stringify(output.files))
      commitConfig(options.configDir, output.files)
    return output.content
  } finally {
    rmSync(lock, { recursive: true, force: true })
  }
}

export function skillConfigDirectory(
  projectRoot: string,
  packageName: string,
  skillName: string,
): string {
  // Hex is portable, collision-free even on case-insensitive filesystems, and
  // cannot introduce path separators, reserved device names, or dot segments.
  const encode = (name: string) => 's-' + Buffer.from(name).toString('hex')
  return join(
    projectRoot,
    '.intent',
    'skill-config',
    encode(packageName),
    ...skillName.split('/').map(encode),
  )
}

export function parseAnswerPairs(answers: unknown): Array<TransformAnswer> {
  const values: Array<unknown> =
    answers === undefined ? [] : Array.isArray(answers) ? answers : [answers]
  return values.map((value) => {
    const separator = typeof value === 'string' ? value.indexOf('=') : -1
    if (typeof value !== 'string' || separator < 1)
      throw new Error(
        'Each --answer must be question=value with a nonempty question ID',
      )
    return {
      question: value.slice(0, separator),
      answer: value.slice(separator + 1),
    }
  })
}

export async function readConfigureStdin(
  input: NodeJS.ReadStream = process.stdin,
): Promise<string> {
  if (input.isTTY) return ''
  const chunks: Array<Buffer> = []
  let size = 0
  for await (const chunk of input) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > MAX_BYTES) throw new Error('Transform stdin exceeds 4 MiB')
    chunks.push(buffer)
  }
  return Buffer.concat(chunks).toString('utf8')
}
