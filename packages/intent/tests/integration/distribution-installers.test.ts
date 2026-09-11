import { execFileSync, spawnSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

const gh = process.env.INTENT_GH_SKILL_BIN
const skills = process.env.INTENT_SKILLS_BIN
const claude = process.env.INTENT_CLAUDE_BIN
const cli = join(dirname(fileURLToPath(import.meta.url)), '../../dist/cli.mjs')

it.skipIf(!gh || !skills)(
  'installs selected skills and prerequisites from multiple packages with real external installers',
  () => {
    const root = mkdtempSync(join(tmpdir(), 'intent-distribution-installers-'))
    const source = join(root, 'source')
    function write(path: string, content: string) {
      mkdirSync(dirname(join(source, path)), { recursive: true })
      writeFileSync(join(source, path), content)
    }
    function run(command: string, args: Array<string>, cwd: string) {
      const result = spawnSync(command, args, {
        cwd,
        encoding: 'utf8',
        timeout: 30_000,
        env: {
          ...(command === claude
            ? {
                PATH: process.env.PATH,
                HOME: join(root, 'home'),
                CLAUDE_CONFIG_DIR: join(root, 'claude'),
                DISABLE_AUTOUPDATER: '1',
                CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
              }
            : process.env),
          DISABLE_TELEMETRY: '1',
          DO_NOT_TRACK: '1',
          GH_PROMPT_DISABLED: '1',
        },
      })
      expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
      return result.stdout
    }
    try {
      write(
        'package.json',
        '{"name":"library","repository":"https://github.com/acme/library"}\n',
      )
      write('pnpm-workspace.yaml', 'packages: [packages/*]\n')
      write('packages/client/package.json', '{"name":"@acme/client"}\n')
      write('packages/shared/package.json', '{"name":"@acme/shared"}\n')
      write(
        'skills/root-only/SKILL.md',
        '---\nname: root-only\ndescription: Unselected repository skill.\n---\nNot part of the distribution.\n',
      )
      write(
        '.claude-plugin/plugin.json',
        JSON.stringify({ name: 'acme-library', version: '1.0.0' }),
      )
      run('git', ['-c', 'core.fsmonitor=false', 'init', '-q'], source)
      run(process.execPath, [cli, 'maintainer', 'setup'], source)
      for (const [packageName, name] of [
        ['client', 'query'],
        ['client', 'internal'],
        ['shared', 'shared'],
      ] as const) {
        write(
          `packages/${packageName}/skills/${name}/SKILL.md`,
          `---\nname: ${name}\ndescription: Use for ${name} tasks.\nsources: [package.json]\n${name === 'query' ? 'requires: [shared]\n' : ''}---\n\n# ${name}\n\nRead [the example](references/example.md) and run [the helper](scripts/check.mjs) for the ${name} task.\n`,
        )
        write(
          `packages/${packageName}/skills/${name}/references/example.md`,
          `${name} reference content\n`,
        )
        write(
          `packages/${packageName}/skills/${name}/scripts/check.mjs`,
          `console.log('${name} helper')\n`,
        )
        run(
          process.execPath,
          [
            cli,
            'maintainer',
            'add',
            name,
            '--package',
            `packages/${packageName}`,
            '--domain',
            'queries',
          ],
          source,
        )
      }
      run(
        process.execPath,
        [
          cli,
          'maintainer',
          'setup',
          '--distribution',
          'repo',
          '--skill',
          'query',
          '--skill',
          'shared',
        ],
        source,
      )
      run(process.execPath, [cli, 'maintainer', 'sync'], source)
      const before = readFileSync(
        join(source, 'packages/client/skills/query/SKILL.md'),
        'utf8',
      )
      const instructions = JSON.parse(
        readFileSync(join(source, '.intent/skill-distribution.json'), 'utf8'),
      )
      for (const installer of ['skills', 'gh'] as const) {
        const consumer = join(root, installer)
        mkdirSync(consumer)
        run('git', ['-c', 'core.fsmonitor=false', 'init', '-q'], consumer)
        if (installer === 'skills') {
          run(
            skills!,
            [
              'add',
              source,
              ...instructions.install.skills.slice(4),
              '--agent',
              'codex',
              '--copy',
              '--yes',
            ],
            consumer,
          )
        } else {
          // gh's local mode selects by name; the generated exact path is for GitHub repositories.
          for (const name of ['query', 'shared'])
            run(
              gh!,
              [
                'skill',
                'add',
                source,
                name,
                '--from-local',
                '--agent',
                'codex',
                '--scope',
                'project',
              ],
              consumer,
            )
        }
        const installed = join(consumer, '.agents/skills')
        expect(readdirSync(installed).sort()).toEqual(['query', 'shared'])
        for (const name of ['query', 'shared']) {
          expect(
            readFileSync(join(installed, name, 'SKILL.md'), 'utf8'),
          ).toContain('references/example.md')
          expect(
            readFileSync(
              join(installed, name, 'references/example.md'),
              'utf8',
            ),
          ).toBe(`${name} reference content\n`)
          expect(
            run(
              process.execPath,
              [join(installed, name, 'scripts/check.mjs')],
              consumer,
            ).trim(),
          ).toBe(`${name} helper`)
        }
      }
      expect(
        readFileSync(
          join(source, 'packages/client/skills/query/SKILL.md'),
          'utf8',
        ),
      ).toBe(before)
      execFileSync(gh!, ['skill', 'publish', source, '--dry-run'], {
        cwd: source,
        encoding: 'utf8',
        timeout: 30_000,
      })
      if (claude) {
        expect(
          JSON.parse(
            run(claude, ['plugin', 'validate', source, '--json'], root),
          ).success,
        ).toBe(true)
        run(claude, ['plugin', 'marketplace', 'add', source], root)
        run(
          claude,
          ['plugin', 'install', 'acme-library@acme-library', '--scope', 'user'],
          root,
        )
        const installed = JSON.parse(
          run(claude, ['plugin', 'list', '--json'], root),
        )
        expect(installed).toEqual([
          expect.objectContaining({
            id: 'acme-library@acme-library',
            version: '1.0.0',
            enabled: true,
          }),
        ])
        const details = run(
          claude,
          ['plugin', 'details', 'acme-library@acme-library'],
          root,
        )
        expect(details).toContain('Skills (2)')
        expect(details).toContain('query')
        expect(details).toContain('shared')
        expect(details).not.toContain('internal')
        expect(details).not.toContain('root-only')

        write(
          'packages/client/skills/query/references/example.md',
          'Updated query reference content\n',
        )
        const manifest = JSON.parse(
          readFileSync(join(source, '.claude-plugin/plugin.json'), 'utf8'),
        )
        write(
          '.claude-plugin/plugin.json',
          JSON.stringify({ ...manifest, version: '1.1.0' }),
        )
        run(process.execPath, [cli, 'maintainer', 'sync'], source)
        run(claude, ['plugin', 'marketplace', 'update', 'acme-library'], root)
        run(claude, ['plugin', 'update', 'acme-library@acme-library'], root)
        const updated = JSON.parse(
          run(claude, ['plugin', 'list', '--json'], root),
        )
        expect(updated).toEqual([
          expect.objectContaining({
            id: 'acme-library@acme-library',
            version: '1.1.0',
            enabled: true,
          }),
        ])
        const cachedSkill = join(
          updated[0].installPath,
          'packages/client/skills/query',
        )
        expect(
          readFileSync(join(cachedSkill, 'references/example.md'), 'utf8'),
        ).toBe('Updated query reference content\n')
        expect(
          run(
            process.execPath,
            [join(cachedSkill, 'scripts/check.mjs')],
            root,
          ).trim(),
        ).toBe('query helper')
        run(
          process.execPath,
          [cli, 'maintainer', 'setup', '--distribution', 'none'],
          source,
        )
        run(process.execPath, [cli, 'maintainer', 'sync'], source)
        expect(
          JSON.parse(
            readFileSync(
              join(source, '.claude-plugin/marketplace.json'),
              'utf8',
            ),
          ).plugins,
        ).toEqual([])
        expect(readFileSync(join(cachedSkill, 'SKILL.md'), 'utf8')).toBe(before)
        run(
          claude,
          [
            'plugin',
            'uninstall',
            'acme-library@acme-library',
            '--scope',
            'user',
          ],
          root,
        )
        expect(
          JSON.parse(run(claude, ['plugin', 'list', '--json'], root)),
        ).toEqual([])
      }
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  },
  60_000,
)
