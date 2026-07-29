import { spawn } from 'node:child_process'
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

  it('reads a complete lifecycle event without waiting for stdin to close', async () => {
    const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
    const child = spawn(
      process.execPath,
      [
        resolve(packageDir, 'dist/cli.mjs'),
        'hooks',
        'run',
        '--agent',
        'copilot',
      ],
      {
        cwd: packageDir,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    )
    let stdout = ''
    let stderr = ''
    let stdinError: Error | undefined
    child.stdin.on('error', (error) => {
      stdinError = error
    })
    child.stdout.setEncoding('utf8').on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.setEncoding('utf8').on('data', (chunk) => {
      stderr += chunk
    })
    child.stdin.write(JSON.stringify({ source: 'startup', cwd: packageDir }))

    const exitCode = await new Promise<number | null>((resolveExit, reject) => {
      const timeout = setTimeout(() => {
        child.kill()
        reject(new Error('catalog hook did not exit with stdin held open'))
      }, 4_000)
      child.once('error', (error) => {
        clearTimeout(timeout)
        reject(error)
      })
      child.once('exit', (code) => {
        clearTimeout(timeout)
        resolveExit(code)
      })
    })

    expect(
      exitCode,
      [stderr, stdinError?.message].filter(Boolean).join('\n'),
    ).toBe(0)
    expect(JSON.parse(stdout)).toEqual({
      additionalContext: expect.any(String),
    })
  }, 6_000)
})
