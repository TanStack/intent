import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readIntentArtifacts } from '../src/artifact-coverage.js'

let root: string

function writeArtifact(fileName: string, content: string): void {
  const artifactsDir = join(root, '_artifacts')
  mkdirSync(artifactsDir, { recursive: true })
  writeFileSync(join(artifactsDir, fileName), content)
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'intent-artifacts-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('readIntentArtifacts', () => {
  it('returns null when _artifacts does not exist', () => {
    expect(readIntentArtifacts(root)).toBeNull()
  })

  it('parses package-scoped skill tree package paths', () => {
    writeArtifact(
      'skill_tree.yaml',
      `
library:
  name: '@tanstack/example-server'
  version: '1.2.3'
skills:
  - name: 'Server Setup'
    slug: 'server-setup'
    path: 'packages/server/skills/server-setup/SKILL.md'
    package: 'packages/server'
    sources:
      - 'TanStack/example:docs/server/overview.md'
`,
    )

    const artifacts = readIntentArtifacts(root)

    expect(artifacts?.skillTrees).toHaveLength(1)
    expect(artifacts?.skillTrees[0]).toMatchObject({
      kind: 'skill-tree',
      libraryName: '@tanstack/example-server',
      libraryVersion: '1.2.3',
    })
    expect(artifacts?.skills[0]).toMatchObject({
      artifactKind: 'skill-tree',
      name: 'Server Setup',
      slug: 'server-setup',
      path: 'packages/server/skills/server-setup/SKILL.md',
      package: 'packages/server',
      packages: ['packages/server'],
      sources: ['TanStack/example:docs/server/overview.md'],
    })
  })

  it('parses Router Start split skill tree and domain map files', () => {
    writeArtifact(
      'start_skill_tree.yaml',
      `
library:
  name: '@tanstack/react-start'
  version: '1.166.2'
generated_from:
  domain_map: '_artifacts/start_domain_map.yaml'
skills:
  - name: 'Start Core'
    slug: 'start-core'
    path: 'skills/start-core/SKILL.md'
    package: 'packages/start-client-core'
`,
    )
    writeArtifact(
      'start_domain_map.yaml',
      `
library:
  name: '@tanstack/react-start'
  version: '1.166.2'
skills:
  - name: 'Start Setup'
    slug: 'start-setup'
    packages:
      - '@tanstack/react-start'
      - '@tanstack/start-plugin-core'
    covers:
      - tanstackStart Vite plugin
      - getRouter() factory pattern
`,
    )

    const artifacts = readIntentArtifacts(root)

    expect(artifacts?.skillTrees.map((file) => file.path)).toEqual([
      join(root, '_artifacts', 'start_skill_tree.yaml'),
    ])
    expect(artifacts?.domainMaps.map((file) => file.path)).toEqual([
      join(root, '_artifacts', 'start_domain_map.yaml'),
    ])
    expect(artifacts?.skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artifactKind: 'skill-tree',
          slug: 'start-core',
          packages: ['packages/start-client-core'],
        }),
        expect.objectContaining({
          artifactKind: 'domain-map',
          slug: 'start-setup',
          packages: ['@tanstack/react-start', '@tanstack/start-plugin-core'],
          covers: ['tanstackStart Vite plugin', 'getRouter() factory pattern'],
        }),
      ]),
    )
  })

  it('parses coverage ignored packages from strings and objects', () => {
    writeArtifact(
      'skill_tree.yaml',
      `
coverage:
  ignored_packages:
    - '@scope/internal'
    - name: 'packages/devtools'
      reason: 'internal tooling'
`,
    )

    const artifacts = readIntentArtifacts(root)

    expect(artifacts?.ignoredPackages).toEqual([
      {
        packageName: '@scope/internal',
        artifactPath: join(root, '_artifacts', 'skill_tree.yaml'),
      },
      {
        packageName: 'packages/devtools',
        reason: 'internal tooling',
        artifactPath: join(root, '_artifacts', 'skill_tree.yaml'),
      },
    ])
  })

  it('records invalid YAML warnings instead of throwing', () => {
    writeArtifact('skill_tree.yaml', 'skills:\n  - name: [broken\n')

    const artifacts = readIntentArtifacts(root)

    expect(artifacts?.warnings).toHaveLength(1)
    expect(artifacts?.warnings[0]?.message).toContain('Invalid YAML')
    expect(artifacts?.skills).toEqual([])
  })
})
