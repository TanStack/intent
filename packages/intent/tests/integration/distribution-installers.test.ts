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
const cli = join(dirname(fileURLToPath(import.meta.url)), '../../dist/cli.mjs')

it.skipIf(!gh || !skills)(
  'installs only the selected package skill with real external installers',
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
          ...process.env,
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
      run('git', ['-c', 'core.fsmonitor=false', 'init', '-q'], source)
      run(process.execPath, [cli, 'maintainer', 'setup'], source)
      for (const name of ['query', 'internal']) {
        write(
          `packages/client/skills/${name}/SKILL.md`,
          `---\nname: ${name}\ndescription: Use for ${name} tasks.\nsources: [package.json]\n---\n\n# ${name}\n\nRead [the example](references/example.md) for the ${name} task.\n`,
        )
        write(
          `packages/client/skills/${name}/references/example.md`,
          `${name} reference content\n`,
        )
        run(
          process.execPath,
          [
            cli,
            'maintainer',
            'add',
            name,
            '--package',
            'packages/client',
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
          run(
            gh!,
            [
              'skill',
              'add',
              source,
              'query',
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
        expect(readdirSync(installed)).toEqual(['query'])
        expect(
          readFileSync(join(installed, 'query/SKILL.md'), 'utf8'),
        ).toContain('references/example.md')
        expect(
          readFileSync(join(installed, 'query/references/example.md'), 'utf8'),
        ).toBe('query reference content\n')
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
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  },
  60_000,
)
