import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { rewriteLoadedSkillMarkdownDestinations } from '../src/core/markdown.js'

const cwd = '/repo'
const packageRoot = join(cwd, 'node_modules', 'pkg')
const skillFilePath = join(packageRoot, 'skills', 'core', 'SKILL.md')

function rewrite(content: string): string {
  return rewriteLoadedSkillMarkdownDestinations({
    content,
    cwd,
    packageRoot,
    skillFilePath,
  })
}

describe('rewriteLoadedSkillMarkdownDestinations', () => {
  it('rewrites nested-label links while preserving query and hash suffixes', () => {
    expect(rewrite('[API [v1]](docs/api.md?raw=1#setup)')).toBe(
      '[API [v1]](node_modules/pkg/skills/core/docs/api.md?raw=1#setup)',
    )
  })

  it('rewrites image destinations with escaped closing parens', () => {
    expect(rewrite('![Diagram](assets/flow\\).png)')).toBe(
      '![Diagram](node_modules/pkg/skills/core/assets/flow\\).png)',
    )
  })

  it('preserves malformed inline links', () => {
    expect(rewrite('[Broken](docs/api.md')).toBe('[Broken](docs/api.md')
  })

  it('does not rewrite links in fenced code blocks', () => {
    expect(rewrite('~~~md\n[Keep](docs/api.md)\n~~~')).toBe(
      '~~~md\n[Keep](docs/api.md)\n~~~',
    )
  })
})
