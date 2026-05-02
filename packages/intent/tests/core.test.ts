import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  IntentCoreError,
  listIntentSkills,
  loadIntentSkill,
} from '../src/core.js'

const realTmpdir = realpathSync(tmpdir())

function writeJson(filePath: string, data: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(data, null, 2))
}

function writeSkillMd({
  content = 'Skill content here.',
  dir,
  frontmatter,
}: {
  content?: string
  dir: string
  frontmatter: Record<string, unknown>
}): void {
  mkdirSync(dir, { recursive: true })
  const yamlLines = Object.entries(frontmatter)
    .map(
      ([key, value]) =>
        `${key}: ${typeof value === 'string' ? `"${value}"` : value}`,
    )
    .join('\n')

  writeFileSync(join(dir, 'SKILL.md'), `---\n${yamlLines}\n---\n\n${content}\n`)
}

function writeInstalledIntentPackage(
  root: string,
  {
    description,
    framework,
    name,
    skillName,
    type,
    version,
  }: {
    description: string
    framework?: string
    name: string
    skillName: string
    type?: string
    version: string
  },
): void {
  const pkgDir = join(root, 'node_modules', ...name.split('/'))
  writeJson(join(pkgDir, 'package.json'), {
    name,
    version,
    intent: { version: 1, repo: 'TanStack/test', docs: 'docs/' },
  })
  writeSkillMd({
    dir: join(pkgDir, 'skills', skillName),
    frontmatter: {
      name: skillName,
      description,
      ...(type ? { type } : {}),
      ...(framework ? { framework } : {}),
    },
  })
}

let root: string
let originalCwd: string

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(realTmpdir, 'intent-core-test-')))
  originalCwd = process.cwd()
})

afterEach(() => {
  process.chdir(originalCwd)
  rmSync(root, { recursive: true, force: true })
})

describe('listIntentSkills', () => {
  it('returns a flat skill list and package summaries', () => {
    writeInstalledIntentPackage(root, {
      name: '@tanstack/query',
      version: '5.0.0',
      skillName: 'fetching',
      description: 'Query data fetching patterns',
      type: 'skill',
      framework: 'react',
    })

    const result = listIntentSkills({ cwd: root })

    expect(result).toEqual({
      skills: [
        {
          use: '@tanstack/query#fetching',
          packageName: '@tanstack/query',
          packageVersion: '5.0.0',
          packageSource: 'local',
          skillName: 'fetching',
          description: 'Query data fetching patterns',
          type: 'skill',
          framework: 'react',
        },
      ],
      packages: [
        {
          name: '@tanstack/query',
          version: '5.0.0',
          source: 'local',
          skillCount: 1,
        },
      ],
      warnings: [],
      conflicts: [],
    })
  })

  it('hides packages matched by configured exclude globs', () => {
    writeJson(join(root, 'package.json'), {
      name: 'test-app',
      private: true,
      intent: { exclude: ['@tanstack/*devtools*'] },
    })
    writeInstalledIntentPackage(root, {
      name: '@tanstack/query',
      version: '5.0.0',
      skillName: 'fetching',
      description: 'Query data fetching patterns',
    })
    writeInstalledIntentPackage(root, {
      name: '@tanstack/devtools',
      version: '1.0.0',
      skillName: 'panel',
      description: 'Devtools panel skill',
    })

    const result = listIntentSkills({ cwd: root })

    expect(result.packages.map((pkg) => pkg.name)).toEqual([
      '@tanstack/query',
    ])
    expect(result.skills.map((skill) => skill.use)).toEqual([
      '@tanstack/query#fetching',
    ])
  })

  it('merges root, package, and option excludes', () => {
    const appDir = join(root, 'packages', 'app')
    writeJson(join(root, 'package.json'), {
      name: 'test-monorepo',
      private: true,
      intent: { exclude: ['@scope/root-only'] },
    })
    writeFileSync(
      join(root, 'pnpm-workspace.yaml'),
      'packages:\n  - packages/*\n',
    )
    writeJson(join(appDir, 'package.json'), {
      name: '@scope/app',
      intent: { exclude: ['@scope/app-only'] },
    })

    for (const packageName of [
      '@scope/root-only',
      '@scope/app-only',
      '@scope/option-only',
    ]) {
      expect(() =>
        loadIntentSkill(`${packageName}#core`, {
          cwd: appDir,
          exclude: ['@scope/option-only'],
        }),
      ).toThrow(
        `Cannot load skill use "${packageName}#core": package "${packageName}" is excluded by Intent configuration.`,
      )
    }
  })
})

describe('loadIntentSkill', () => {
  it('loads skill content with package metadata', () => {
    writeInstalledIntentPackage(root, {
      name: '@tanstack/query',
      version: '5.0.0',
      skillName: 'fetching',
      description: 'Query data fetching patterns',
    })

    const result = loadIntentSkill('@tanstack/query#fetching', { cwd: root })

    expect(result).toEqual({
      content: expect.stringContaining('Skill content here.'),
      path: 'node_modules/@tanstack/query/skills/fetching/SKILL.md',
      packageRoot: join(root, 'node_modules', '@tanstack', 'query'),
      packageName: '@tanstack/query',
      skillName: 'fetching',
      version: '5.0.0',
      source: 'local',
      warnings: [],
      conflict: null,
    })
  })

  it('rewrites relative markdown destinations in loaded content', () => {
    const pkgDir = join(root, 'node_modules', '@tanstack', 'query')
    const skillDir = join(pkgDir, 'skills', 'fetching')
    writeJson(join(pkgDir, 'package.json'), {
      name: '@tanstack/query',
      version: '5.0.0',
      intent: { version: 1, repo: 'TanStack/query', docs: 'docs/' },
    })
    writeSkillMd({
      dir: skillDir,
      frontmatter: {
        name: 'fetching',
        description: 'Query data fetching patterns',
      },
      content: [
        '- [Reference](references/topic.md)',
        '- ![Diagram](assets/diagram.png)',
        '- [Parent](../shared.md#setup)',
        '- [External](https://example.com/reference.md)',
        '- `inline [Code](references/code.md)`',
        '```md',
        '[Fenced](references/fenced.md)',
        '```',
      ].join('\n'),
    })

    const result = loadIntentSkill('@tanstack/query#fetching', { cwd: root })

    expect(result.content).toContain(
      '[Reference](node_modules/@tanstack/query/skills/fetching/references/topic.md)',
    )
    expect(result.content).toContain(
      '![Diagram](node_modules/@tanstack/query/skills/fetching/assets/diagram.png)',
    )
    expect(result.content).toContain(
      '[Parent](node_modules/@tanstack/query/skills/shared.md#setup)',
    )
    expect(result.content).toContain(
      '[External](https://example.com/reference.md)',
    )
    expect(result.content).toContain('`inline [Code](references/code.md)`')
    expect(result.content).toContain('[Fenced](references/fenced.md)')
  })

  it('fails clearly when the requested skill is missing', () => {
    writeInstalledIntentPackage(root, {
      name: '@tanstack/query',
      version: '5.0.0',
      skillName: 'fetching',
      description: 'Query data fetching patterns',
    })

    expect(() =>
      loadIntentSkill('@tanstack/query#mutations', { cwd: root }),
    ).toThrow(IntentCoreError)
    expect(() =>
      loadIntentSkill('@tanstack/query#mutations', { cwd: root }),
    ).toThrow(
      'Cannot resolve skill use "@tanstack/query#mutations": skill "mutations" was not found in package "@tanstack/query".',
    )
  })

  it('fails clearly when the package is excluded', () => {
    writeInstalledIntentPackage(root, {
      name: '@tanstack/devtools',
      version: '1.0.0',
      skillName: 'panel',
      description: 'Devtools panel skill',
    })

    expect(() =>
      loadIntentSkill('@tanstack/devtools#panel', {
        cwd: root,
        exclude: ['@tanstack/*devtools*'],
      }),
    ).toThrow(IntentCoreError)
    expect(() =>
      loadIntentSkill('@tanstack/devtools#panel', {
        cwd: root,
        exclude: ['@tanstack/*devtools*'],
      }),
    ).toThrow(
      'Cannot load skill use "@tanstack/devtools#panel": package "@tanstack/devtools" is excluded by Intent configuration.',
    )
  })
})
