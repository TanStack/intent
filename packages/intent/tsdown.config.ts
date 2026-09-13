import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts', 'src/core.ts'],
  format: 'esm',
  platform: 'node',
  dts: true,
  onSuccess(config) {
    const packageDir = fileURLToPath(new URL('.', import.meta.url))
    const root = join(packageDir, '../..')
    const version = JSON.parse(
      readFileSync(join(packageDir, 'package.json'), 'utf8'),
    ).version
    let commit: string | null = null
    try {
      const git = (...args: Array<string>) =>
        execFileSync('git', ['-c', 'core.fsmonitor=false', ...args], {
          cwd: root,
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        })
      const head = git('rev-parse', 'HEAD').trim()
      // A development build must not claim an older commit contains its
      // edited workflows. A released package carries its verified snapshot.
      if (
        ['check-skills', 'review-skills', 'publish-skill-review'].every(
          (name) => {
            const path = `.github/workflows/${name}.yml`
            return (
              git('show', `${head}:${path}`) ===
              readFileSync(join(root, path), 'utf8')
            )
          },
        )
      )
        commit = head
    } catch {
      // Source archives and uncommitted workflows have no verifiable pin.
    }
    if (process.env.GITHUB_ACTIONS === 'true' && !commit)
      throw new Error(
        'Cannot package workflows without their committed release reference.',
      )
    writeFileSync(
      join(config.outDir, 'workflow-ref.json'),
      JSON.stringify({ version, commit }) + '\n',
    )
  },
  // The libraries this package uses at runtime are declared as
  // devDependencies so tsdown bundles them into dist. The published package
  // then installs with zero dependencies, and the CLI starts faster because
  // Node loads a few tree-shaken chunks instead of ~150 files spread across
  // node_modules (yaml alone was 72 CommonJS modules and ~45ms).
  alias: {
    // jsonc-parser's `main` is a UMD build that rolldown cannot bundle (it
    // requires './impl/*' at runtime); point at its ESM build instead.
    'jsonc-parser': fileURLToPath(
      new URL('./node_modules/jsonc-parser/lib/esm/main.js', import.meta.url),
    ),
  },
})
