import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  formatRuntimeSkillLookupComment,
  formatRuntimeSkillLookupHint,
  hasPackageManagerInternalPath,
  isAbsolutePath,
  isRuntimeSkillLookupComment,
  isStableLoadPath,
  rewriteSkillLoadPaths,
} from '../src/skill-paths.js'
import type { SkillEntry } from '../src/types.js'

const tempDirs: Array<string> = []

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'intent-skill-paths-'))
  tempDirs.push(root)
  return root
}

function skill(path: string): SkillEntry {
  return {
    name: 'core',
    path,
    description: '',
  }
}

describe('skill path helpers', () => {
  it('detects absolute paths across common operating systems', () => {
    expect(isAbsolutePath('/home/sarah/project/SKILL.md')).toBe(true)
    expect(isAbsolutePath('C:\\Users\\sarah\\project\\SKILL.md')).toBe(true)
    expect(isAbsolutePath('C:/Users/sarah/project/SKILL.md')).toBe(true)
    expect(isAbsolutePath('\\\\server\\share\\project\\SKILL.md')).toBe(true)
    expect(
      isAbsolutePath('node_modules/@tanstack/query/skills/core/SKILL.md'),
    ).toBe(false)
  })

  it('detects package-manager-internal paths', () => {
    expect(
      hasPackageManagerInternalPath(
        'node_modules/.pnpm/@tanstack+query@1.0.0/node_modules/@tanstack/query/skills/core/SKILL.md',
      ),
    ).toBe(true)
    expect(
      hasPackageManagerInternalPath(
        'node_modules\\.bun\\@tanstack-query\\skills\\core\\SKILL.md',
      ),
    ).toBe(true)
    expect(
      hasPackageManagerInternalPath(
        'node_modules/@tanstack/query/skills/core/SKILL.md',
      ),
    ).toBe(false)
  })

  it('allows only stable repo-relative load paths', () => {
    expect(
      isStableLoadPath('node_modules/@tanstack/query/skills/core/SKILL.md'),
    ).toBe(true)
    expect(isStableLoadPath('/home/sarah/project/SKILL.md')).toBe(false)
    expect(isStableLoadPath('../outside/skills/core/SKILL.md')).toBe(false)
    expect(
      isStableLoadPath(
        'node_modules/.pnpm/@tanstack+query@1.0.0/node_modules/@tanstack/query/skills/core/SKILL.md',
      ),
    ).toBe(false)
    expect(isStableLoadPath('')).toBe(false)
  })

  it('rewrites to stable node_modules load paths when a top-level package path exists', () => {
    const root = tempRoot()
    const packageRoot = join(root, 'node_modules', '@tanstack', 'query')
    const skillPath = join(packageRoot, 'skills', 'core', 'SKILL.md')
    mkdirSync(join(packageRoot, 'skills', 'core'), { recursive: true })
    const skills = [skill(skillPath)]

    rewriteSkillLoadPaths({
      packageName: '@tanstack/query',
      packageRoot,
      projectRoot: root,
      skills,
    })

    expect(skills[0]!.path).toBe(
      'node_modules/@tanstack/query/skills/core/SKILL.md',
    )
  })

  it('does not invent stable top-level load paths for pnpm-internal package paths', () => {
    const root = tempRoot()
    const packageRoot = join(
      root,
      'node_modules',
      '.pnpm',
      '@tanstack+query@5.0.0',
      'node_modules',
      '@tanstack',
      'query',
    )
    const skillPath = join(packageRoot, 'skills', 'core', 'SKILL.md')
    mkdirSync(join(packageRoot, 'skills', 'core'), { recursive: true })
    const skills = [skill(skillPath)]

    rewriteSkillLoadPaths({
      packageName: '@tanstack/query',
      packageRoot,
      projectRoot: root,
      skills,
    })

    expect(skills[0]!.path).toContain('node_modules/.pnpm/')
    expect(skills[0]!.path).not.toBe(
      'node_modules/@tanstack/query/skills/core/SKILL.md',
    )
  })

  it('formats runtime lookup guidance without shell-specific tools', () => {
    const target = {
      packageName: '@tanstack/query',
      skillName: 'query-core/fetching',
    }

    const comment = formatRuntimeSkillLookupComment(target)
    const hint = formatRuntimeSkillLookupHint(target)

    expect(comment).toContain('npx @tanstack/intent@latest list --json')
    expect(comment).toContain('package "@tanstack/query"')
    expect(comment).toContain('skill "query-core/fetching"')
    expect(comment).toContain('Do not copy the resolved path into this file.')
    expect(comment).not.toContain('grep')
    expect(comment).not.toContain('|')
    expect(hint).toBe(`Lookup: ${comment}`)
    expect(isRuntimeSkillLookupComment(comment)).toBe(true)
    expect(isRuntimeSkillLookupComment(`# ${comment}`)).toBe(true)
    expect(
      isRuntimeSkillLookupComment(
        'Runtime lookup only: run `npx @tanstack/intent@latest list --json`.',
      ),
    ).toBe(false)
  })
})
