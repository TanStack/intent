import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IntentDiscoveryFixture } from '../corpus/tasks'

const evalDir = dirname(dirname(fileURLToPath(import.meta.url)))
const fixturesDir = join(evalDir, 'fixtures')

export type PreparedFixtureWorkspace = {
  sourcePath: string
  workspacePath: string
  cleanup: () => void
}

export function prepareFixtureWorkspace({
  fixture,
  parentDir,
}: {
  fixture: IntentDiscoveryFixture
  parentDir?: string
}): PreparedFixtureWorkspace {
  const sourcePath = join(fixturesDir, fixture)

  if (!existsSync(sourcePath)) {
    throw new Error(`Fixture does not exist: ${fixture}`)
  }

  const rootDir =
    parentDir ?? mkdtempSync(join(realpathSync(tmpdir()), 'intent-eval-'))
  mkdirSync(rootDir, { recursive: true })

  const workspacePath = join(rootDir, basename(sourcePath))
  rmSync(workspacePath, { recursive: true, force: true })
  cpSync(sourcePath, workspacePath, {
    recursive: true,
    verbatimSymlinks: true,
    filter: (source) => !source.includes(`${fixturesDir}${sep}runs${sep}`),
  })

  return {
    sourcePath,
    workspacePath,
    cleanup() {
      if (parentDir) {
        rmSync(workspacePath, { recursive: true, force: true })
        return
      }

      rmSync(rootDir, { recursive: true, force: true })
    },
  }
}
