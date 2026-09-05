import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parse as parseYaml } from 'yaml'
import { main } from '../src/cli.js'
import { listIntentSkills, loadIntentSkill } from '../src/core/index.js'
import { scanForIntents } from '../src/discovery/scanner.js'
import { buildIntentSkillsBlock } from '../src/commands/install/guidance.js'
import { formatRuntimeSkillLookupHint } from '../src/skills/paths.js'
import { nodeReadFs } from '../src/shared/utils.js'
import { formatIntentCommand } from '../src/shared/command-runner.js'

const packageName = '@scope/library'
let root: string
let originalCwd: string

function write(file: string, content: string): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content)
}

function skillFile(description: string): string {
  return `---\nname: core\ndescription: ${description}\n---\n\nSkill body.\n`
}

function packageRoot(): string {
  return join(root, 'node_modules', '@scope', 'library')
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'intent-discovery-safety-')))
  originalCwd = process.cwd()
  write(
    join(root, 'package.json'),
    JSON.stringify({ intent: { skills: [packageName] } }),
  )
  write(
    join(packageRoot(), 'package.json'),
    JSON.stringify({
      name: packageName,
      version: '1.0.0',
      intent: { version: 1, repo: 'scope/library', docs: 'docs/' },
    }),
  )
})

afterEach(() => {
  process.chdir(originalCwd)
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

describe('discovered command arguments', () => {
  it.skipIf(process.platform === 'win32')(
    'round-trips scoped and nested identifiers through installed POSIX shells',
    async () => {
      const skillName = 'guide/nested-entry_v2.0'
      const use = `${packageName}#${skillName}`
      write(
        join(packageRoot(), 'skills', skillName, 'SKILL.md'),
        skillFile('Nested skill'),
      )
      const scan = scanForIntents(root)
      const block = buildIntentSkillsBlock(scan).block
      const yaml = block.replace(/<!--[^>]*-->/g, '')
      const mappings = parseYaml(yaml) as {
        tanstackIntent: Array<{ run: string }>
      }
      const command = mappings.tanstackIntent[0]!.run
      expect(loadIntentSkill(use, { cwd: root }).skillName).toBe(skillName)

      process.chdir(root)
      const log = vi.spyOn(console, 'log').mockImplementation(() => {})
      expect(await main(['list'])).toBe(0)
      expect(log.mock.calls.flat().join('\n')).toContain(command)

      const hint = formatRuntimeSkillLookupHint({ packageName, skillName })
      const hintCommand = hint.split('`')[1]!
      const runners = ['npm', 'pnpm', 'yarn', 'bun', 'unknown'] as const
      const stubs =
        'npx() { printf "%s\\n" "$@"; }; pnpm() { printf "%s\\n" "$@"; }; yarn() { printf "%s\\n" "$@"; }; bunx() { printf "%s\\n" "$@"; }; '
      for (const shell of ['/bin/sh', '/bin/bash', '/bin/zsh'].filter(
        existsSync,
      )) {
        for (const runner of runners) {
          const generated = formatIntentCommand(runner, [
            'load',
            use,
            '--global',
          ])
          const actual = execFileSync(shell, ['-c', stubs + generated], {
            encoding: 'utf8',
          })
            .trim()
            .split('\n')
          expect(actual).toEqual([
            ...(runner === 'pnpm' || runner === 'yarn' ? ['dlx'] : []),
            '@tanstack/intent@latest',
            'load',
            use,
            '--global',
          ])
        }
        expect(
          execFileSync(shell, ['-c', stubs + command], { encoding: 'utf8' })
            .trim()
            .split('\n'),
        ).toEqual(['@tanstack/intent@latest', 'load', use])
        expect(
          execFileSync(shell, ['-c', stubs + hintCommand], { encoding: 'utf8' })
            .trim()
            .split('\n'),
        ).toEqual(['@tanstack/intent@latest', 'load', use, '--path'])
      }
    },
  )

  it.each([
    'core;echo injected',
    'core$(echo injected)',
    'core`echo injected`',
    'core"quoted',
    "core'quoted",
    'core with spaces',
    'core\nnext',
    'core\rnext',
    'core\tnext',
    'core%PATH%',
    'core!PATH!',
    'core&echo',
    'core|echo',
    ' core',
    'core ',
    '\tcore\n',
  ])('refuses runnable commands for unsafe skill names: %j', (skillName) => {
    // A scan result can contain names that are not valid filenames on this host.
    write(
      join(packageRoot(), 'skills', 'core', 'SKILL.md'),
      skillFile('Safe description'),
    )
    const scan = scanForIntents(root)
    scan.packages[0]!.skills[0]!.name = skillName

    expect(() => buildIntentSkillsBlock(scan)).toThrow(
      'Cannot generate an Intent command',
    )
    expect(() =>
      formatRuntimeSkillLookupHint({ packageName, skillName }),
    ).toThrow('Cannot generate an Intent command')
  })

  it.each([' @scope/library', '@scope/library ', '\t@scope/library\n'])(
    'refuses whitespace-wrapped package names: %j',
    (unsafePackage) => {
      write(
        join(packageRoot(), 'skills', 'core', 'SKILL.md'),
        skillFile('Safe'),
      )
      const scan = scanForIntents(root)
      scan.packages[0]!.name = unsafePackage
      expect(() => buildIntentSkillsBlock(scan)).toThrow(
        'Cannot generate an Intent command',
      )
      expect(() =>
        formatRuntimeSkillLookupHint({
          packageName: unsafePackage,
          skillName: 'core',
        }),
      ).toThrow('Cannot generate an Intent command')
    },
  )

  it('does not emit a trimmed identifier for a different existing skill', async () => {
    write(
      join(packageRoot(), 'skills', 'core', 'SKILL.md'),
      skillFile('Other skill'),
    )
    write(
      join(packageRoot(), 'skills', ' core ', 'SKILL.md'),
      skillFile('Whitespace skill'),
    )
    process.chdir(root)
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await main(['list'])).toBe(1)
  })

  it('refuses an unsafe identifier in runnable list output', async () => {
    write(
      join(packageRoot(), 'skills', 'core;echo injected', 'SKILL.md'),
      skillFile('Safe description'),
    )
    process.chdir(root)
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    expect(await main(['list'])).toBe(1)
    expect(error.mock.calls.flat().join('\n')).toContain(
      'Cannot generate an Intent command',
    )
    expect(log.mock.calls.flat().join('\n')).not.toContain(
      'npx @tanstack/intent@latest load @scope/library#core;echo',
    )
  })
})

describe('discovered metadata containment', () => {
  it('rejects a parent-directory replacement during the identity check', () => {
    const file = join(packageRoot(), 'skills', 'core', 'SKILL.md')
    const outside = join(root, 'outside', 'SKILL.md')
    write(file, skillFile('Internal'))
    write(outside, skillFile('EXTERNAL_METADATA_SENTINEL'))
    const lstat = nodeReadFs.lstatSync
    let replaced = false
    vi.spyOn(nodeReadFs, 'lstatSync').mockImplementation(
      (...args: Parameters<typeof lstat>) => {
        if (args[0] === file && !replaced) {
          replaced = true
          renameSync(dirname(file), `${dirname(file)}.original`)
          symlinkSync(dirname(outside), dirname(file), 'junction')
        }
        return lstat(...args)
      },
    )
    const read = vi.spyOn(nodeReadFs, 'readSync')
    const result = listIntentSkills({ cwd: root })
    expect(replaced).toBe(true)
    expect(result.skills).toEqual([])
    expect(read).not.toHaveBeenCalled()
  })

  it.each(['file', 'directory'] as const)(
    'rejects a %s replaced with an escaping symlink before open',
    (kind) => {
      const file = join(packageRoot(), 'skills', 'core', 'SKILL.md')
      const outside = join(root, 'outside', 'SKILL.md')
      write(file, skillFile('Internal'))
      write(outside, skillFile('EXTERNAL_METADATA_SENTINEL'))
      const open = nodeReadFs.openSync!
      const read = vi.spyOn(nodeReadFs, 'readSync')
      const close = vi.spyOn(nodeReadFs, 'closeSync')
      let replaced = false
      vi.spyOn(nodeReadFs, 'openSync').mockImplementation(
        (path, flags, mode) => {
          if (path === file && !replaced) {
            replaced = true
            const target = kind === 'file' ? file : dirname(file)
            renameSync(target, `${target}.original`)
            symlinkSync(
              kind === 'file' ? outside : dirname(outside),
              target,
              kind === 'file' ? 'file' : 'junction',
            )
          }
          return open(path, flags, mode)
        },
      )
      const result = listIntentSkills({ cwd: root })
      expect(replaced).toBe(true)
      expect(result.skills).toEqual([])
      expect(read).not.toHaveBeenCalled()
      if (kind === 'directory') expect(close).toHaveBeenCalledTimes(1)
      expect(JSON.stringify(result)).not.toContain('EXTERNAL_METADATA_SENTINEL')
    },
  )

  it.each([false, true])(
    'reads the validated descriptor after replacement (large frontmatter: %s)',
    (large) => {
      const file = join(packageRoot(), 'skills', 'core', 'SKILL.md')
      const outside = join(root, 'outside', 'SKILL.md')
      const internal = large
        ? `---\nname: core\npadding: ${'x'.repeat(20_000)}\ndescription: Internal\n---\n`
        : skillFile('Internal')
      write(file, internal)
      write(outside, skillFile('EXTERNAL_METADATA_SENTINEL'))
      const read = nodeReadFs.readSync!
      let replaced = false
      vi.spyOn(nodeReadFs, 'readSync').mockImplementation(
        (...args: Parameters<typeof read>) => {
          if (!replaced) {
            replaced = true
            renameSync(file, `${file}.original`)
            symlinkSync(outside, file)
          }
          return read(...args)
        },
      )
      const result = listIntentSkills({ cwd: root })
      expect(replaced).toBe(true)
      expect(result.skills[0]?.description).toBe('Internal')
      expect(JSON.stringify(result)).not.toContain('EXTERNAL_METADATA_SENTINEL')
    },
  )

  it('closes the descriptor when reading frontmatter fails', () => {
    write(
      join(packageRoot(), 'skills', 'core', 'SKILL.md'),
      skillFile('Internal'),
    )
    vi.spyOn(nodeReadFs, 'readSync').mockImplementation(() => {
      throw new Error('read failed')
    })
    const close = vi.spyOn(nodeReadFs, 'closeSync')
    expect(listIntentSkills({ cwd: root }).skills[0]?.description).toBe('')
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('does not read escaping frontmatter through discovery or direct loading', () => {
    const outside = join(root, 'outside', 'SKILL.md')
    const link = join(packageRoot(), 'skills', 'core', 'SKILL.md')
    write(outside, skillFile('EXTERNAL_METADATA_SENTINEL'))
    mkdirSync(dirname(link), { recursive: true })
    symlinkSync(outside, link)
    const read = vi.spyOn(nodeReadFs, 'readFileSync')

    const listed = listIntentSkills({ cwd: root, audience: 'human' })
    expect(listed.skills).toEqual([])
    expect(JSON.stringify(listed)).not.toContain('EXTERNAL_METADATA_SENTINEL')
    expect(buildIntentSkillsBlock(scanForIntents(root)).mappingCount).toBe(0)
    expect(() => loadIntentSkill(`${packageName}#core`, { cwd: root })).toThrow(
      'outside package root',
    )
    expect(
      read.mock.calls.some(([path]) => path === outside || path === link),
    ).toBe(false)
  })

  it('keeps in-package skill symlinks loadable', () => {
    const target = join(packageRoot(), 'references', 'core.md')
    const link = join(packageRoot(), 'skills', 'core', 'SKILL.md')
    write(target, skillFile('Internal metadata'))
    mkdirSync(dirname(link), { recursive: true })
    symlinkSync(target, link)

    expect(listIntentSkills({ cwd: root }).skills[0]?.description).toBe(
      'Internal metadata',
    )
    expect(
      loadIntentSkill(`${packageName}#core`, { cwd: root }).content,
    ).toContain('Skill body.')
  })

  it.each([packageName, '@scope/hidden"source'])(
    'redacts rejected metadata diagnostics for unlisted agent source %s',
    (hiddenName) => {
      const outside = join(root, 'outside', 'SKILL.md')
      const link = join(packageRoot(), 'skills', 'core', 'SKILL.md')
      write(outside, skillFile('EXTERNAL_METADATA_SENTINEL'))
      write(
        join(packageRoot(), 'package.json'),
        JSON.stringify({
          name: hiddenName,
          version: '1.0.0',
          intent: { version: 1, repo: 'scope/library', docs: 'docs/' },
        }),
      )
      mkdirSync(dirname(link), { recursive: true })
      symlinkSync(outside, link)
      write(
        join(root, 'package.json'),
        JSON.stringify({ intent: { skills: [] } }),
      )

      const listed = listIntentSkills({ cwd: root, audience: 'agent' })
      expect(listed.warnings).toEqual([])
      expect(JSON.stringify(listed)).not.toContain(packageName)
      expect(JSON.stringify(listed)).not.toContain(
        JSON.stringify(hiddenName).slice(1, -1),
      )
      expect(JSON.stringify(listed)).not.toContain(outside)
      expect(JSON.stringify(listed)).not.toContain('EXTERNAL_METADATA_SENTINEL')
    },
  )
})
