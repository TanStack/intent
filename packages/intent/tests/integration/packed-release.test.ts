import { execFileSync, spawnSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const timeout = 30_000
let root: string
let installedRoot: string
let cli: string
let cwd: string
let packedFiles: Array<string>

function run(args: Array<string>) {
  return spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    timeout,
  })
}

beforeAll(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'intent-packed-release-')))
  const packed = JSON.parse(
    execFileSync(
      'npm',
      ['pack', '--ignore-scripts', '--json', '--pack-destination', root],
      {
        cwd: packageRoot,
        encoding: 'utf8',
        timeout,
        env: { ...process.env, npm_config_cache: join(root, 'npm-cache') },
      },
    ),
  ) as Array<{ filename: string; files: Array<{ path: string }> }>
  packedFiles = packed[0]!.files.map((file) => file.path)
  installedRoot = join(root, 'node_modules', '@tanstack', 'intent')
  mkdirSync(installedRoot, { recursive: true })
  execFileSync(
    'tar',
    [
      '-xzf',
      join(root, packed[0]!.filename),
      '-C',
      installedRoot,
      '--strip-components=1',
    ],
    { timeout },
  )
  // Exercise only packed Intent files; reuse installed runtime dependencies
  // without downloading packages or running lifecycle scripts in the test.
  symlinkSync(
    join(packageRoot, 'node_modules'),
    join(installedRoot, 'node_modules'),
    'junction',
  )
  cli = join(installedRoot, 'dist', 'cli.mjs')
}, timeout)

beforeEach(() => {
  cwd = mkdtempSync(join(root, 'consumer-'))
  writeFileSync(
    join(cwd, 'package.json'),
    '{"name":"consumer","private":true}\n',
  )
  const leaf = join(cwd, 'node_modules', 'release-fixture')
  mkdirSync(join(leaf, 'skills', 'core'), { recursive: true })
  writeFileSync(
    join(leaf, 'package.json'),
    JSON.stringify({
      name: 'release-fixture',
      version: '1.0.0',
      intent: { version: 1, repo: 'test/fixture', docs: 'docs/' },
    }),
  )
  writeFileSync(
    join(leaf, 'skills', 'core', 'SKILL.md'),
    '---\nname: core\ndescription: Release smoke fixture.\n---\n\nPacked release guidance.\n',
  )
})

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true })
})

describe('packed release', () => {
  it('ships every meta resource and validates the extracted skills', () => {
    const meta = join(packageRoot, 'meta')
    for (const entry of readdirSync(meta, {
      recursive: true,
      encoding: 'utf8',
    })) {
      if (!statSync(join(meta, entry)).isFile()) continue
      const packedPath = `meta/${entry.replaceAll('\\', '/')}`
      expect(packedFiles).toContain(packedPath)
      expect(readFileSync(join(installedRoot, packedPath))).toEqual(
        readFileSync(join(meta, entry)),
      )
    }
    const result = run(['validate', join(installedRoot, 'meta')])
    expect(result.status, result.stderr).toBe(0)
  })

  it('resolves meta and scaffold paths from the extracted package', () => {
    for (const name of [
      'domain-discovery',
      'generate-skill',
      'tree-generator',
      'skill-staleness-check',
    ]) {
      const result = run(['meta', name])
      expect(result.status, result.stderr).toBe(0)
      expect(result.stdout).toContain(`name: ${name}\n`)
      if (name === 'domain-discovery') {
        expect(result.stdout).toContain(
          `](${join(installedRoot, 'meta', name, 'references', 'deep-read.md')})`,
        )
        expect(result.stdout).toContain(
          `](${join(installedRoot, 'meta', name, 'references', 'artifacts.md')})`,
        )
      }
    }
    const scaffold = run(['scaffold'])
    expect(scaffold.status, scaffold.stderr).toBe(0)
    expect(scaffold.stdout).toContain(
      join(installedRoot, 'meta', 'domain-discovery', 'SKILL.md'),
    )
    expect(scaffold.stdout).toContain(
      join(installedRoot, 'meta', 'tree-generator', 'SKILL.md'),
    )
    expect(scaffold.stdout).toContain(
      join(installedRoot, 'meta', 'generate-skill', 'SKILL.md'),
    )
  })

  it.each(['cancel', 'confirm'] as const)(
    'preserves the first-install %s contract in the bundle',
    (decision) => {
      const original = readFileSync(join(cwd, 'package.json'), 'utf8')
      // Use the CLI's existing prompt seam; the remaining command path is bundled.
      const result = spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `
      import { main } from ${JSON.stringify(pathToFileURL(cli).href)};
      process.exitCode = await main(['install'], {
        isTTY: true,
        permissionPrompts: {
          selectPermissions: async () => ['release-fixture#core'],
          reviewPermissions: async (_groups, selection) => selection,
          confirmWrite: async () => ${decision === 'confirm'},
        },
      });
    `,
        ],
        { cwd, encoding: 'utf8', timeout },
      )
      expect(result.status, result.stderr).toBe(0)
      if (decision === 'cancel') {
        expect(readFileSync(join(cwd, 'package.json'), 'utf8')).toBe(original)
        expect(existsSync(join(cwd, 'AGENTS.md'))).toBe(false)
        return
      }
      const policy = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'))
      expect(policy.intent.skills).toEqual(['release-fixture#core'])
      const guidance = readFileSync(join(cwd, 'AGENTS.md'), 'utf8')
      expect(guidance).toContain('intent-skills:start')
      const repeat = run(['install'])
      expect(repeat.status, repeat.stderr).toBe(0)
      expect(readFileSync(join(cwd, 'AGENTS.md'), 'utf8')).toBe(guidance)
      const listed = run(['list', '--json'])
      expect(listed.status, listed.stderr).toBe(0)
      expect(
        JSON.parse(listed.stdout).skills.map(
          (skill: { use: string }) => skill.use,
        ),
      ).toEqual(['release-fixture#core'])
      const loaded = run(['load', 'release-fixture#core'])
      expect(loaded.status, loaded.stderr).toBe(0)
      expect(loaded.stdout).toContain('Packed release guidance.')
    },
  )

  it('fails first-time noninteractive installation without writing', () => {
    const original = readFileSync(join(cwd, 'package.json'), 'utf8')
    const result = run(['install'])
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('interactive terminal')
    expect(readFileSync(join(cwd, 'package.json'), 'utf8')).toBe(original)
    expect(existsSync(join(cwd, 'AGENTS.md'))).toBe(false)
  })
})
