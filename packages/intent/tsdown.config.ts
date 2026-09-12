import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts', 'src/cli.ts', 'src/core.ts'],
  format: 'esm',
  platform: 'node',
  dts: true,
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
