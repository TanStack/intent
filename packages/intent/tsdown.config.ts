import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { build, defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts', 'src/core.ts'],
  format: 'esm',
  platform: 'node',
  dts: { entry: ['src/index.ts', 'src/core.ts'] },
  async onSuccess(config) {
    // A single bundle is passed via stdin so the restricted child needs no
    // filesystem grants, including for loading the VFS implementation.
    await build({
      config: false,
      entry: { 'transform-worker': 'src/transforms/worker.ts' },
      outDir: config.outDir,
      clean: false,
      format: 'esm',
      platform: 'node',
      target: 'node22',
      dts: false,
      minify: true,
      // Avoid loading the unused SQLite/real-filesystem providers.
      alias: {
        '@platformatic/vfs': fileURLToPath(
          new URL(
            './node_modules/@platformatic/vfs/lib/file_system.js',
            import.meta.url,
          ),
        ),
      },
      deps: { alwaysBundle: ['@platformatic/vfs'] },
    })
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
    'jsonc-parser/lib/esm/main.js': fileURLToPath(
      new URL(
        './node_modules/jsonc-parser/lib/esm/impl/parser.js',
        import.meta.url,
      ),
    ),
    // yaml's `node` export condition is a CommonJS build that rolldown cannot
    // tree-shake; point at the ES module build its `default` condition serves.
    yaml: fileURLToPath(
      new URL('./node_modules/yaml/browser/index.js', import.meta.url),
    ),
  },
})
