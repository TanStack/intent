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
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
// @ts-ignore Could not find a declaration file for module 'markdown-link-extractor'.
import markdownLinkExtractor from 'markdown-link-extractor'

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
      const links: Array<string> = markdownLinkExtractor(result.stdout)
      for (const link of links) {
        if (/^(https?:|#)/.test(link)) continue
        const target = link.split('#')[0]!
        expect(isAbsolute(target), link).toBe(true)
        expect(target.startsWith(join(installedRoot, 'meta')), link).toBe(true)
        expect(statSync(target).isFile(), link).toBe(true)
      }
    }
    const entries = readdirSync(cwd, { recursive: true, encoding: 'utf8' })
    const originals = entries
      .filter((entry) => statSync(join(cwd, entry)).isFile())
      .map((entry) => [entry, readFileSync(join(cwd, entry))] as const)
    const scaffold = run(['scaffold'])
    expect(scaffold.status, scaffold.stderr).toBe(0)
    expect(scaffold.stderr).toBe('')
    expect(scaffold.stdout).toContain(
      join(installedRoot, 'meta', 'domain-discovery', 'SKILL.md'),
    )
    expect(scaffold.stdout).toContain(
      join(installedRoot, 'meta', 'tree-generator', 'SKILL.md'),
    )
    expect(scaffold.stdout).toContain(
      join(installedRoot, 'meta', 'generate-skill', 'SKILL.md'),
    )
    const entryPaths: Array<string> = markdownLinkExtractor(scaffold.stdout)
    expect(entryPaths).toEqual(
      ['generate-skill', 'domain-discovery', 'tree-generator'].map((name) =>
        join(installedRoot, 'meta', name, 'SKILL.md'),
      ),
    )
    expect(readdirSync(cwd, { recursive: true, encoding: 'utf8' })).toEqual(
      entries,
    )
    for (const [entry, content] of originals) {
      expect(readFileSync(join(cwd, entry))).toEqual(content)
    }
  })

  it('keeps nested authoring references usable within the extracted package', () => {
    for (const file of packedFiles.filter(
      (path) => path.startsWith('meta/') && path.endsWith('.md'),
    )) {
      const path = join(installedRoot, file)
      const links: Array<string> = markdownLinkExtractor(
        readFileSync(path, 'utf8'),
      )
      for (const link of links) {
        if (/^(https?:|#)/.test(link)) continue
        const target = resolve(dirname(path), link.split('#')[0]!)
        expect(
          target.startsWith(join(installedRoot, 'meta')),
          `${file}: ${link}`,
        ).toBe(true)
        expect(statSync(target).isFile(), `${file}: ${link}`).toBe(true)
      }
    }
  })

  it('validates a manually authored skill without maintainer setup', () => {
    const skillDir = join(cwd, 'skills', 'read-meta')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(
      join(skillDir, 'SKILL.md'),
      `---
name: read-meta
description: Read bundled Intent authoring guidance from a library repository.
metadata:
  type: core
  library: '@tanstack/intent'
  library_version: '0.4.0'
sources:
  - 'TanStack/intent:packages/intent/src/commands/meta.ts'
---

# Read authoring guidance

Run \`npx @tanstack/intent meta\` to discover public meta-skill names, then
\`npx @tanstack/intent meta generate-skill\` for the focused authoring procedure.
The command prints Markdown; it does not create skill files. Read linked
references only when their stated condition applies. Relative links printed
by the command resolve from the caller's directory.

If a name is unknown, list the names again. A successful read exits with 0
and prints the selected skill's frontmatter and body.
`,
    )
    const result = run(['validate', 'skills'])
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('Validated 1 skill files — all passed')
    expect(readdirSync(join(cwd, 'skills'))).toEqual(['read-meta'])
    expect(existsSync(join(cwd, '_artifacts'))).toBe(false)
  })

  it('routes local and generated review reports to the shipped focused procedure', () => {
    writeFileSync(
      join(cwd, 'package.json'),
      JSON.stringify({ name: 'consumer', version: '1.1.0', private: true }),
    )
    const skillDir = join(cwd, 'skills', 'review-requests')
    mkdirSync(skillDir, { recursive: true })
    const skillPath = join(skillDir, 'SKILL.md')
    const original = `---
name: review-requests
description: Review incoming consumer requests.
metadata:
  type: core
  library: consumer
  library_version: '1.0.0'
---

# Review requests

Existing fixture guidance, pending source review.
`
    writeFileSync(skillPath, original)

    const local = run(['stale'])
    expect(local.status, local.stderr).toBe(0)
    expect(local.stdout).toContain('review-requests')
    expect(local.stdout).toContain('meta generate-skill')
    expect(existsSync(join(cwd, 'review-items.json'))).toBe(false)

    const json = run(['stale', '--json'])
    expect(json.status, json.stderr).toBe(0)
    const reports = JSON.parse(json.stdout)
    expect(reports[0].skills).toEqual([
      expect.objectContaining({ name: 'review-requests', needsReview: true }),
    ])

    const review = spawnSync(
      process.execPath,
      [cli, 'stale', '--github-review'],
      {
        cwd,
        encoding: 'utf8',
        timeout,
        env: {
          ...process.env,
          GITHUB_OUTPUT: join(cwd, 'github-output'),
          GITHUB_STEP_SUMMARY: join(cwd, 'github-summary'),
        },
      },
    )
    expect(review.status, review.stderr).toBe(0)
    const items = JSON.parse(
      readFileSync(join(cwd, 'review-items.json'), 'utf8'),
    )
    expect(items).toEqual([
      expect.objectContaining({
        type: 'stale-skill',
        subject: 'review-requests',
        library: 'consumer',
        reasons: ['version drift (1.0.0 → 1.1.0)'],
      }),
    ])
    const body = readFileSync(join(cwd, 'pr-body.md'), 'utf8')
    expect(body).toContain(
      '| `stale-skill` | `review-requests` | `consumer` | version drift &#40;1.0.0 → 1.1.0&#41; |',
    )
    expect(body).toContain('### Agent Review')
    expect(body).not.toContain('Paste this into your coding agent')
    expect(body).toContain('npx @tanstack/intent@latest meta generate-skill')

    // Execute the advertised meta command with this extracted release.
    const procedure = run(['meta', 'generate-skill'])
    expect(procedure.status, procedure.stderr).toBe(0)
    const links: Array<string> = markdownLinkExtractor(procedure.stdout)
    const reviewReference = join(
      installedRoot,
      'meta',
      'generate-skill',
      'references',
      'review-signals.md',
    )
    expect(links).toContain(reviewReference)
    const guidance = readFileSync(reviewReference, 'utf8')
    expect(guidance).toContain('stale-check-failed')
    expect(guidance).toContain('workflow-advisory')
    expect(readFileSync(skillPath, 'utf8')).toBe(original)
    expect(existsSync(join(cwd, '_artifacts'))).toBe(false)
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

  it('requires the planning records after maintainer setup in the packed CLI', () => {
    execFileSync('git', ['-c', 'core.fsmonitor=false', 'init', '-q'], { cwd })
    execFileSync(
      'git',
      [
        '-c',
        'core.fsmonitor=false',
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.invalid',
        'commit',
        '--allow-empty',
        '-qm',
        'fixture',
      ],
      { cwd },
    )
    expect(run(['install', '--maintainer']).status).toBe(0)
    const missingRecords = JSON.parse(run(['review', '--json']).stdout)
    expect(
      missingRecords.items.find(
        (item: { kind: string }) => item.kind === 'planning',
      ).problems,
    ).toHaveLength(3)
    expect(run(['review', '--check']).status).toBe(1)
  })

  it('installs the maintainer workflow and reviews sources with the packed CLI', () => {
    execFileSync('git', ['-c', 'core.fsmonitor=false', 'init', '-q'], { cwd })
    execFileSync(
      'git',
      [
        '-c',
        'core.fsmonitor=false',
        '-c',
        'user.name=Fixture',
        '-c',
        'user.email=fixture@example.invalid',
        'commit',
        '--allow-empty',
        '-qm',
        'fixture',
      ],
      { cwd },
    )
    const installed = run(['install', '--maintainer'])
    expect(installed.status, installed.stderr).toBe(0)
    expect(readFileSync(join(cwd, 'AGENTS.md'), 'utf8')).toContain(
      'intent-maintainer:start',
    )
    expect(packedFiles).toContain(
      'meta/generate-skill/references/initial-batches.md',
    )
    expect(packedFiles).toContain(
      'meta/generate-skill/references/task-quality.md',
    )
    expect(packedFiles).toContain(
      'meta/generate-skill/references/source-review.md',
    )
    expect(packedFiles).toContain(
      'meta/generate-skill/references/planning-records.md',
    )
    mkdirSync(join(cwd, 'src'))
    writeFileSync(join(cwd, 'src/client.js'), 'export const attempts = 3\n')
    mkdirSync(join(cwd, 'skills/client'), { recursive: true })
    writeFileSync(
      join(cwd, 'skills/client/SKILL.md'),
      '---\nname: client\nsources: [src/client.js]\n---\nClient task\n',
    )
    mkdirSync(join(cwd, 'skills/_artifacts'))
    writeFileSync(
      join(cwd, 'skills/_artifacts/domain_map.yaml'),
      'library: {name: consumer}\nskills: [{slug: client}]\n',
    )
    writeFileSync(
      join(cwd, 'skills/_artifacts/skill_spec.md'),
      '# Consumer skills\n\nClient task: three attempts.\n',
    )
    writeFileSync(
      join(cwd, 'skills/_artifacts/skill_tree.yaml'),
      'skills: [{slug: client, path: skills/client/SKILL.md}]\n',
    )
    const review = run(['review', '--json'])
    expect(review.status, review.stderr).toBe(0)
    const report = JSON.parse(review.stdout)
    expect(report.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'skill',
          path: 'skills/client/SKILL.md',
          problems: [],
        }),
      ]),
    )
    for (const item of report.items) {
      item.outcome = 'no-change'
      item.reason = 'Fixture source and guidance agree.'
      item.evidence = ['src/client.js']
    }
    mkdirSync(join(cwd, '.intent'))
    writeFileSync(join(cwd, '.intent/review.json'), JSON.stringify(report))
    const recorded = run(['review', '--record', '.intent/review.json'])
    expect(recorded.status, recorded.stderr).toBe(0)
    expect(run(['review', '--check']).status).toBe(0)
    writeFileSync(join(cwd, 'src/client.js'), 'export const attempts = 4\n')
    expect(run(['review', '--check']).status).toBe(1)
  })
})
