import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { INSTALL_PROMPT } from '../src/install-prompt.js'
import { main, USAGE } from '../src/cli.js'

const thisDir = dirname(fileURLToPath(import.meta.url))
const metaDir = join(thisDir, '..', 'meta')
const packageJsonPath = join(thisDir, '..', 'package.json')

function writeJson(filePath: string, data: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(data, null, 2))
}

function writeSkillMd(dir: string, frontmatter: Record<string, unknown>): void {
  mkdirSync(dir, { recursive: true })
  const yamlLines = Object.entries(frontmatter)
    .map(
      ([key, value]) =>
        `${key}: ${typeof value === 'string' ? `"${value}"` : value}`,
    )
    .join('\n')

  writeFileSync(
    join(dir, 'SKILL.md'),
    `---\n${yamlLines}\n---\n\nSkill content here.\n`,
  )
}

let originalCwd: string
let logSpy: ReturnType<typeof vi.spyOn>
let errorSpy: ReturnType<typeof vi.spyOn>
let tempDirs: Array<string>

beforeEach(() => {
  originalCwd = process.cwd()
  tempDirs = []
  logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  process.chdir(originalCwd)
  logSpy.mockRestore()
  errorSpy.mockRestore()
  for (const dir of tempDirs) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true })
    }
  }
})

describe('intent meta', () => {
  it('lists the shipped public meta-skills', async () => {
    const exitCode = await main(['meta'])
    const output = logSpy.mock.calls.flat().join('\n')

    expect(exitCode).toBe(0)
    expect(output).toContain('Meta-skills')
    expect(output).toContain('domain-discovery')
    expect(output).toContain('tree-generator')
    expect(output).toContain('generate-skill')
    expect(output).toContain('skill-staleness-check')
  })

  it('prints the requested meta-skill content', async () => {
    const expected = readFileSync(
      join(metaDir, 'domain-discovery', 'SKILL.md'),
      'utf8',
    )

    const exitCode = await main(['meta', 'domain-discovery'])

    expect(exitCode).toBe(0)
    expect(logSpy).toHaveBeenCalledWith(expected)
  })
})

describe('cli commands', () => {
  it('prints usage when no command is provided', async () => {
    const exitCode = await main([])

    expect(exitCode).toBe(0)
    expect(logSpy).toHaveBeenCalledWith(USAGE)
  })

  it('prints the install prompt', async () => {
    const exitCode = await main(['install'])

    expect(exitCode).toBe(0)
    expect(logSpy).toHaveBeenCalledWith(INSTALL_PROMPT)
  })

  it('lists installed intent packages as json', async () => {
    const root = mkdtempSync(join(tmpdir(), 'intent-cli-list-'))
    tempDirs.push(root)
    const pkgDir = join(root, 'node_modules', '@tanstack', 'db')

    writeJson(join(pkgDir, 'package.json'), {
      name: '@tanstack/db',
      version: '0.5.2',
      intent: { version: 1, repo: 'TanStack/db', docs: 'docs/' },
    })
    writeSkillMd(join(pkgDir, 'skills', 'db-core'), {
      name: 'db-core',
      description: 'Core database concepts',
    })

    process.chdir(root)

    const exitCode = await main(['list', '--json'])
    const output = logSpy.mock.calls.at(-1)?.[0]
    const parsed = JSON.parse(String(output)) as {
      packages: Array<{ name: string; version: string; packageRoot: string }>
      warnings: Array<string>
    }

    expect(exitCode).toBe(0)
    expect(parsed.packages).toHaveLength(1)
    expect(parsed.packages[0]).toMatchObject({
      name: '@tanstack/db',
      version: '0.5.2',
      packageRoot: pkgDir,
    })
    expect(parsed.warnings).toEqual([])
  })

  it('validates a well-formed skills directory', async () => {
    const root = mkdtempSync(join(tmpdir(), 'intent-cli-validate-'))
    tempDirs.push(root)

    writeSkillMd(join(root, 'skills', 'db-core'), {
      name: 'db-core',
      description: 'Core database concepts',
    })

    process.chdir(root)

    const exitCode = await main(['validate'])

    expect(exitCode).toBe(0)
    expect(logSpy).toHaveBeenCalledWith(
      '✅ Validated 1 skill files — all passed',
    )
  })
})

describe('package metadata', () => {
  it('uses a package-manager-neutral prepack script', () => {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
      scripts?: Record<string, string>
    }

    expect(packageJson.scripts?.prepack).toBe('npm run build')
  })
})
