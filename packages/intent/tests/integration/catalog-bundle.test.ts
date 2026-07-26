import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const staticImportPattern =
  /\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]/g

function getStaticImports(source: string): Array<string> {
  return [...source.matchAll(staticImportPattern)].map((match) => match[1]!)
}

describe('catalog bundle', () => {
  it('does not statically import yaml or semver', () => {
    const distDir = resolve(
      dirname(fileURLToPath(import.meta.url)),
      '../../dist',
    )
    const pending = [resolve(distDir, 'catalog.mjs')]
    const visited = new Set<string>()

    while (pending.length > 0) {
      const modulePath = pending.pop()!
      if (visited.has(modulePath)) continue
      visited.add(modulePath)

      for (const specifier of getStaticImports(
        readFileSync(modulePath, 'utf8'),
      )) {
        expect(specifier).not.toBe('yaml')
        expect(specifier).not.toBe('semver')

        if (specifier.startsWith('.')) {
          pending.push(resolve(dirname(modulePath), specifier))
        }
      }
    }
  })
})
