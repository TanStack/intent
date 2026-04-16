import { describe, expect, it } from 'vitest'
import { resolveSkillUse, ResolveSkillUseError } from '../src/resolver.js'
import type {
  IntentPackage,
  ScanResult,
  SkillEntry,
  VersionConflict,
} from '../src/types.js'

function skill(
  name: string,
  path = `node_modules/pkg/skills/${name}/SKILL.md`,
): SkillEntry {
  return {
    name,
    path,
    description: `${name} skill`,
  }
}

function intentPackage(
  overrides: Partial<IntentPackage> & Pick<IntentPackage, 'name'>,
): IntentPackage {
  return {
    intent: {
      docs: 'docs/',
      repo: 'test/repo',
      version: 1,
    },
    packageRoot: `node_modules/${overrides.name}`,
    skills: [skill('core')],
    source: 'local',
    version: '1.0.0',
    ...overrides,
  }
}

function scanResult(
  packages: Array<IntentPackage>,
  {
    conflicts = [],
    warnings = [],
  }: {
    conflicts?: Array<VersionConflict>
    warnings?: Array<string>
  } = {},
): ScanResult {
  return {
    conflicts,
    nodeModules: {
      global: {
        detected: false,
        exists: false,
        path: null,
        scanned: false,
      },
      local: {
        detected: true,
        exists: true,
        path: 'node_modules',
        scanned: true,
      },
    },
    packageManager: 'npm',
    packages,
    warnings,
  }
}

describe('resolveSkillUse', () => {
  it('resolves a local package and exact skill', () => {
    const pkg = intentPackage({
      name: '@tanstack/query',
      skills: [
        skill('core', 'node_modules/@tanstack/query/skills/core/SKILL.md'),
      ],
      version: '5.0.0',
    })

    expect(resolveSkillUse('@tanstack/query#core', scanResult([pkg]))).toEqual({
      conflict: null,
      packageName: '@tanstack/query',
      packageRoot: 'node_modules/@tanstack/query',
      path: 'node_modules/@tanstack/query/skills/core/SKILL.md',
      skillName: 'core',
      source: 'local',
      version: '5.0.0',
      warnings: [],
    })
  })

  it('resolves slash-named skills', () => {
    const pkg = intentPackage({
      name: '@tanstack/query',
      skills: [
        skill(
          'core/fetching',
          'node_modules/@tanstack/query/skills/core/fetching/SKILL.md',
        ),
      ],
    })

    const result = resolveSkillUse(
      '@tanstack/query#core/fetching',
      scanResult([pkg]),
    )

    expect(result.skillName).toBe('core/fetching')
    expect(result.path).toBe(
      'node_modules/@tanstack/query/skills/core/fetching/SKILL.md',
    )
  })

  it('returns pnpm-internal paths reported by the scanner', () => {
    const pnpmPath =
      'node_modules/.pnpm/@tanstack+query@5.0.0/node_modules/@tanstack/query/skills/core/SKILL.md'
    const pkg = intentPackage({
      name: '@tanstack/query',
      packageRoot:
        'node_modules/.pnpm/@tanstack+query@5.0.0/node_modules/@tanstack/query',
      skills: [skill('core', pnpmPath)],
      version: '5.0.0',
    })

    const result = resolveSkillUse('@tanstack/query#core', scanResult([pkg]))

    expect(result.path).toBe(pnpmPath)
    expect(result.path).not.toBe(
      'node_modules/@tanstack/query/skills/core/SKILL.md',
    )
  })

  it('prefers local packages over global packages when both are present', () => {
    const globalPkg = intentPackage({
      name: '@tanstack/query',
      skills: [skill('core', '/global/@tanstack/query/skills/core/SKILL.md')],
      source: 'global',
      version: '4.0.0',
    })
    const localPkg = intentPackage({
      name: '@tanstack/query',
      skills: [
        skill('core', 'node_modules/@tanstack/query/skills/core/SKILL.md'),
      ],
      source: 'local',
      version: '5.0.0',
    })

    const result = resolveSkillUse(
      '@tanstack/query#core',
      scanResult([globalPkg, localPkg]),
    )

    expect(result.source).toBe('local')
    expect(result.version).toBe('5.0.0')
    expect(result.path).toBe(
      'node_modules/@tanstack/query/skills/core/SKILL.md',
    )
  })

  it('returns the scanner-selected package version', () => {
    const pkg = intentPackage({
      name: '@tanstack/query',
      version: '5.0.0',
    })

    const result = resolveSkillUse('@tanstack/query#core', scanResult([pkg]))

    expect(result.version).toBe('5.0.0')
  })

  it('includes relevant scanner warnings and structured conflicts', () => {
    const conflict: VersionConflict = {
      chosen: {
        packageRoot: 'node_modules/@tanstack/query',
        version: '5.0.0',
      },
      packageName: '@tanstack/query',
      variants: [
        {
          packageRoot: 'node_modules/@tanstack/query',
          version: '5.0.0',
        },
        {
          packageRoot: 'node_modules/consumer/node_modules/@tanstack/query',
          version: '4.0.0',
        },
      ],
    }
    const warning =
      'Found 2 installed variants of @tanstack/query across 2 versions. Using 5.0.0.'
    const unrelatedWarning =
      'Found 2 installed variants of @tanstack/router across 2 versions.'

    const result = resolveSkillUse(
      '@tanstack/query#core',
      scanResult(
        [intentPackage({ name: '@tanstack/query', version: '5.0.0' })],
        {
          conflicts: [conflict],
          warnings: [warning, unrelatedWarning],
        },
      ),
    )

    expect(result.conflict).toBe(conflict)
    expect(result.warnings).toEqual([warning])
  })

  it('fails clearly when the package is missing', () => {
    expect(() => {
      resolveSkillUse(
        '@tanstack/query#core',
        scanResult([intentPackage({ name: '@tanstack/router' })]),
      )
    }).toThrow(ResolveSkillUseError)
    expect(() => {
      resolveSkillUse(
        '@tanstack/query#core',
        scanResult([intentPackage({ name: '@tanstack/router' })]),
      )
    }).toThrow('package "@tanstack/query" was not found')
  })

  it('fails clearly when the skill is missing', () => {
    expect(() => {
      resolveSkillUse(
        '@tanstack/query#mutations',
        scanResult([intentPackage({ name: '@tanstack/query' })]),
      )
    }).toThrow(ResolveSkillUseError)
    expect(() => {
      resolveSkillUse(
        '@tanstack/query#mutations',
        scanResult([intentPackage({ name: '@tanstack/query' })]),
      )
    }).toThrow('skill "mutations" was not found')
  })
})
