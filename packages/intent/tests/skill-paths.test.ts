import { describe, expect, it } from 'vitest'
import {
  formatRuntimeSkillLookupComment,
  formatRuntimeSkillLookupHint,
  hasPackageManagerInternalPath,
  isAbsolutePath,
  isRuntimeSkillLookupComment,
  isStableLoadPath,
} from '../src/skill-paths.js'

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
