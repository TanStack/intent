import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { main } from '../src/cli.js'
import { listIntentSkills, resolveIntentSkill } from '../src/core/index.js'
import { rewriteLoadedSkillMarkdownDestinations } from '../src/core/markdown.js'
import { checkStaleness } from '../src/staleness/check.js'
import type * as NodeFs from 'node:fs'
import type * as NodePath from 'node:path'

vi.mock('node:fs', async (importOriginal) => {
  const fs = await importOriginal<typeof NodeFs>()
  return {
    ...fs,
    readFileSync: vi.fn(fs.readFileSync),
    readdirSync: vi.fn(fs.readdirSync),
    lstatSync: vi.fn(fs.lstatSync),
  }
})

vi.mock('node:path', async (importOriginal) => {
  const path = await importOriginal<typeof NodePath>()
  return { ...path, resolve: vi.fn(path.resolve) }
})

let root: string
let previousCwd: string

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function writePackage(dir: string, name: string): void {
  write(
    join(dir, 'package.json'),
    JSON.stringify({
      name,
      version: '1.0.0',
      intent: { version: 1, repo: 'example/test', docs: 'docs/' },
    }),
  )
  write(
    join(dir, 'skills', 'core', 'SKILL.md'),
    '---\nname: core\ndescription: Core workflow\nmetadata:\n  library_version: "1.0.0"\n---\nGuide.\n',
  )
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'intent-repeated-work-')))
  previousCwd = process.cwd()
  process.chdir(root)
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.clearAllMocks()
})

afterEach(() => {
  process.chdir(previousCwd)
  rmSync(root, { recursive: true, force: true })
  vi.restoreAllMocks()
})

describe('command work budgets', () => {
  it('indexes each skill path once when matching many artifact entries by name', async () => {
    write(
      join(root, 'package.json'),
      JSON.stringify({ name: 'example', version: '1.0.0' }),
    )
    const names = Array.from({ length: 16 }, (_, index) => `skill-${index}`)
    for (const name of names) {
      write(
        join(root, 'skills', name, 'SKILL.md'),
        `---\nname: ${name}\ndescription: Guide\n---\nGuide.\n`,
      )
    }
    write(
      join(root, '_artifacts', 'skill_tree.yaml'),
      JSON.stringify({ skills: names.map((name) => ({ slug: name })) }),
    )
    const report = await checkStaleness(root)
    expect(report.skills).toHaveLength(16)
    expect(report.signals).toEqual([])
    for (const name of names) {
      expect(
        vi
          .mocked(resolve)
          .mock.calls.filter(
            ([path]) => path === join(root, 'skills', name, 'SKILL.md'),
          ),
      ).toHaveLength(1)
    }
  })
  it('classifies a direct dependency without statting every workspace package', () => {
    write(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'consumer',
        dependencies: { example: '1.0.0' },
        intent: { skills: ['example'] },
      }),
    )
    write(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n')
    const packageDirs = Array.from({ length: 120 }, (_, index) =>
      join(root, 'packages', `pkg-${index}`),
    )
    for (const dir of packageDirs) write(join(dir, 'package.json'), '{}')
    writePackage(join(root, 'node_modules', 'example'), 'example')

    expect(resolveIntentSkill('example#core', { cwd: root }).skillName).toBe(
      'core',
    )
    expect(
      vi
        .mocked(lstatSync)
        .mock.calls.filter(([path]) => packageDirs.includes(String(path))),
    ).toHaveLength(0)
  })

  it.each([false, true])(
    'refreshes explicitly symlinked workspace identities between loads (siblings: %s)',
    (hasSibling) => {
      write(
        join(root, 'package.json'),
        JSON.stringify({
          name: 'consumer',
          intent: { skills: ['workspace:example'] },
        }),
      )
      write(
        join(root, 'pnpm-workspace.yaml'),
        'packages:\n  - linked-package\n',
      )
      if (hasSibling) {
        write(
          join(root, 'pnpm-workspace.yaml'),
          'packages:\n  - linked-package\n  - sibling-package\n',
        )
        writePackage(join(root, 'sibling-package'), 'sibling')
      }
      const first = join(root, 'first')
      const second = join(root, 'second')
      writePackage(first, 'example')
      writePackage(second, 'example')
      const workspaceLink = join(root, 'linked-package')
      const dependencyLink = join(root, 'node_modules', 'example')
      mkdirSync(dirname(dependencyLink), { recursive: true })
      symlinkSync(first, workspaceLink, 'dir')
      symlinkSync(first, dependencyLink, 'dir')
      expect(resolveIntentSkill('example#core', { cwd: root }).skillName).toBe(
        'core',
      )

      unlinkSync(workspaceLink)
      symlinkSync(second, workspaceLink, 'dir')
      expect(() => resolveIntentSkill('example#core', { cwd: root })).toThrow(
        'not listed',
      )
      unlinkSync(dependencyLink)
      symlinkSync(second, dependencyLink, 'dir')
      expect(resolveIntentSkill('example#core', { cwd: root }).skillName).toBe(
        'core',
      )
      expect(
        vi.mocked(readdirSync).mock.calls.filter(([path]) => path === root),
      ).toHaveLength(hasSibling ? 3 : 0)
    },
  )
  it('reuses repeated Markdown destinations only within a document', () => {
    const content = `${'[Guide](guide.md#one)\n'.repeat(10)}[Other](guide.md#two)`
    for (const name of ['first', 'second']) {
      const packageRoot = join(root, name)
      const skillDir = join(packageRoot, 'skills', 'core')
      const result = rewriteLoadedSkillMarkdownDestinations({
        content,
        cwd: root,
        packageRoot,
        skillFilePath: join(skillDir, 'SKILL.md'),
      })
      expect(result).toBe(
        `${`[Guide](${name}/skills/core/guide.md#one)\n`.repeat(10)}[Other](${name}/skills/core/guide.md#two)`,
      )
      expect(
        vi
          .mocked(resolve)
          .mock.calls.filter(
            ([from, to]) => from === skillDir && to === 'guide.md',
          ),
      ).toHaveLength(2)
    }
  })
  it.each(['list', 'load'])(
    'shares manifest reads during %s and refreshes policy on the next call',
    (command) => {
      const manifest = join(root, 'package.json')
      const project = {
        name: 'consumer',
        packageManager: 'npm@10.0.0',
        dependencies: { example: '1.0.0' },
      }
      write(manifest, JSON.stringify(project))
      writePackage(join(root, 'node_modules', 'example'), 'example')
      listIntentSkills({ cwd: root })
      vi.clearAllMocks()

      if (command === 'list')
        expect(listIntentSkills({ cwd: root }).skills).toHaveLength(1)
      else
        expect(
          resolveIntentSkill('example#core', { cwd: root }).skillName,
        ).toBe('core')
      expect(
        vi
          .mocked(readFileSync)
          .mock.calls.filter(([path]) => path === manifest),
      ).toHaveLength(1)

      write(manifest, JSON.stringify({ ...project, intent: { skills: [] } }))
      if (command === 'list')
        expect(listIntentSkills({ cwd: root }).skills).toHaveLength(0)
      else
        expect(() => resolveIntentSkill('example#core', { cwd: root })).toThrow(
          'not listed',
        )
    },
  )
  it.each([[], ['skills']])(
    'walks each validation directory once: %j',
    async (...args) => {
      writePackage(root, 'example')
      expect(await main(['validate', ...args])).toBe(0)
      for (const dir of [join(root, 'skills'), join(root, 'skills', 'core')]) {
        expect(
          vi.mocked(readdirSync).mock.calls.filter(([path]) => path === dir),
        ).toHaveLength(1)
      }
      expect(
        vi
          .mocked(readFileSync)
          .mock.calls.filter(
            ([path]) => path === join(root, 'skills', 'core', 'SKILL.md'),
          ),
      ).toHaveLength(1)
    },
  )

  it('reuses discovered manifests and skill files in the fallback stale path', async () => {
    write(
      join(root, 'package.json'),
      JSON.stringify({
        name: 'consumer',
        private: true,
        dependencies: { example: '1.0.0' },
      }),
    )
    write(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n')
    write(join(root, 'packages', 'app', 'package.json'), '{"name":"app"}')
    const packageDir = join(root, 'node_modules', 'example')
    writePackage(packageDir, 'example')

    expect(await main(['stale', '--json'])).toBe(0)
    const reports = JSON.parse(
      vi.mocked(console.log).mock.calls.at(-1)![0] as string,
    )
    expect(reports).toHaveLength(1)
    expect(reports[0]).toMatchObject({
      library: 'example',
      currentVersion: '1.0.0',
      signals: [],
    })
    expect(reports[0].skills).toHaveLength(1)
    expect(
      vi
        .mocked(readFileSync)
        .mock.calls.filter(
          ([path]) => path === join(packageDir, 'package.json'),
        ),
    ).toHaveLength(1)
    for (const dir of [
      join(packageDir, 'skills'),
      join(packageDir, 'skills', 'core'),
    ]) {
      expect(
        vi.mocked(readdirSync).mock.calls.filter(([path]) => path === dir),
      ).toHaveLength(1)
    }
  })

  it('reads workspace artifacts, manifests, and skill trees once per stale invocation', async () => {
    write(
      join(root, 'package.json'),
      JSON.stringify({ name: 'workspace', private: true }),
    )
    write(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n')
    const packageDirs = ['one', 'two'].map((name) => {
      const dir = join(root, 'packages', name)
      writePackage(dir, name)
      return dir
    })
    const artifactPath = join(root, '_artifacts', 'skill_tree.yaml')
    write(
      artifactPath,
      JSON.stringify({
        skills: packageDirs.map((dir) => ({
          path: `${dir}/skills/core/SKILL.md`,
        })),
      }),
    )

    expect(await main(['stale', '--json'])).toBe(0)
    expect(
      vi
        .mocked(readFileSync)
        .mock.calls.filter(([path]) => path === artifactPath),
    ).toHaveLength(1)
    for (const dir of packageDirs) {
      expect(
        vi
          .mocked(readFileSync)
          .mock.calls.filter(([path]) => path === join(dir, 'package.json')),
      ).toHaveLength(1)
      expect(
        vi
          .mocked(readdirSync)
          .mock.calls.filter(([path]) => path === join(dir, 'skills')),
      ).toHaveLength(1)
    }
    const reports = JSON.parse(
      vi.mocked(console.log).mock.calls.at(-1)![0] as string,
    )
    expect(reports).toHaveLength(2)
    expect(
      reports.every(
        (report: { signals: Array<unknown> }) => report.signals.length === 0,
      ),
    ).toBe(true)
  })
})
