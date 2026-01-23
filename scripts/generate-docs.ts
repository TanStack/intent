import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateReferenceDocs } from '@tanstack/typedoc-config'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

await generateReferenceDocs({
  packages: [
    {
      name: 'template',
      entryPoints: [resolve(__dirname, '../packages/template/src/index.ts')],
      tsconfig: resolve(__dirname, '../packages/template/tsconfig.docs.json'),
      outputDir: resolve(__dirname, '../docs/reference'),
    },
    {
      name: 'react-template',
      entryPoints: [
        resolve(__dirname, '../packages/react-template/src/index.ts'),
      ],
      tsconfig: resolve(
        __dirname,
        '../packages/react-template/tsconfig.docs.json',
      ),
      outputDir: resolve(__dirname, '../docs/framework/react/reference'),
      exclude: ['packages/template/**/*'],
    },
    {
      name: 'solid-template',
      entryPoints: [
        resolve(__dirname, '../packages/solid-template/src/index.ts'),
      ],
      tsconfig: resolve(
        __dirname,
        '../packages/solid-template/tsconfig.docs.json',
      ),
      outputDir: resolve(__dirname, '../docs/framework/solid/reference'),
      exclude: ['packages/template/**/*'],
    },
  ],
})

console.log('\n✅ All markdown files have been processed!')

process.exit(0)
