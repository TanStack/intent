import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { generateReferenceDocs } from '@tanstack/typedoc-config'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

await generateReferenceDocs({
  packages: [
    {
      name: 'playbooks',
      entryPoints: [resolve(__dirname, '../packages/playbooks/src/index.ts')],
      tsconfig: resolve(__dirname, '../packages/playbooks/tsconfig.docs.json'),
      outputDir: resolve(__dirname, '../docs/playbooks'),
    },
  ],
})

console.log('\n✅ All markdown files have been processed!')

process.exit(0)
