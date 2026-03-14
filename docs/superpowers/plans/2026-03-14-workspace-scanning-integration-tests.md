# Workspace-Aware Scanning & Integration Tests

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the scanner discover skills from workspace packages when run from a monorepo root, and add integration tests with Verdaccio that verify scanning across all package managers (npm, pnpm, yarn, bun), project structures (single, monorepo root, monorepo workspace), and dependency depths (direct, transitive+1/+2/+3).

**Architecture:** Two changes to the scanner: (1) export `resolveWorkspacePackages` from `setup.ts` so the scanner can discover workspace package directories, (2) add a workspace-aware phase to `scanForIntents` that scans each workspace package's `node_modules` and walks their deps. For integration tests, use Verdaccio (local npm registry) to publish fixture packages, then create real projects with each package manager, install deps, and run the scanner. Follows Knip's pattern: use workspace config to find packages, use direct node_modules path lookup for resolution.

**Tech Stack:** Vitest, Verdaccio (dev dependency), npm/pnpm/yarn/bun CLIs

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/intent/src/setup.ts` | Modify | Export `resolveWorkspacePackages` |
| `packages/intent/src/scanner.ts` | Modify | Add workspace scanning phase |
| `packages/intent/tests/scanner.test.ts` | Modify | Add unit tests for workspace scanning |
| `packages/intent/tests/fixtures/integration/skills-leaf/package.json` | Create | Fixture: package with skills |
| `packages/intent/tests/fixtures/integration/skills-leaf/skills/core/SKILL.md` | Create | Fixture: skill file |
| `packages/intent/tests/fixtures/integration/wrapper-1/package.json` | Create | Fixture: depends on skills-leaf |
| `packages/intent/tests/fixtures/integration/wrapper-2/package.json` | Create | Fixture: depends on wrapper-1 |
| `packages/intent/tests/fixtures/integration/wrapper-3/package.json` | Create | Fixture: depends on wrapper-2 |
| `packages/intent/tests/integration/scaffold.ts` | Create | Helpers: Verdaccio lifecycle, project scaffolding, CLI invocation |
| `packages/intent/tests/integration/scanner-integration.test.ts` | Create | Integration test grid |
| `packages/intent/src/scanner-arborist.ts` | Delete | Remove spike file |

---

## Chunk 1: Scanner Workspace Support

### Task 1: Export `resolveWorkspacePackages` from setup.ts

**Files:**
- Modify: `packages/intent/src/setup.ts:483`

- [ ] **Step 1: Make `resolveWorkspacePackages` exported**

In `packages/intent/src/setup.ts`, change the function declaration at line 483 from:

```typescript
function resolveWorkspacePackages(
```

to:

```typescript
export function resolveWorkspacePackages(
```

No other changes needed — the function already has the right signature.

- [ ] **Step 2: Run existing tests to verify no regression**

Run: `pnpm vitest run tests/setup.test.ts`
Expected: All tests pass (no behavior change, just exported)

- [ ] **Step 3: Commit**

```bash
git add packages/intent/src/setup.ts
git commit -m "refactor: export resolveWorkspacePackages from setup.ts"
```

### Task 2: Write failing test for workspace scanning

**Files:**
- Modify: `packages/intent/tests/scanner.test.ts`

- [ ] **Step 1: Write a test that creates a pnpm-style monorepo and expects skills to be found from the root**

Add this test to the `scanForIntents` describe block in `scanner.test.ts`:

```typescript
it('discovers skills in workspace package dependencies from monorepo root', async () => {
  // Monorepo root with pnpm-workspace.yaml
  writeFileSync(
    join(root, 'pnpm-workspace.yaml'),
    'packages:\n  - packages/*\n',
  )
  writeJson(join(root, 'package.json'), {
    name: 'monorepo',
    private: true,
  })

  // Workspace package that depends on a skills-enabled package
  const appDir = join(root, 'packages', 'app')
  createDir(root, 'packages', 'app')
  writeJson(join(appDir, 'package.json'), {
    name: '@monorepo/app',
    version: '1.0.0',
    dependencies: { '@tanstack/db': '0.5.0' },
  })

  // The skills-enabled package installed in the workspace's node_modules
  createDir(appDir, 'node_modules', '@tanstack', 'db')
  const dbDir = join(appDir, 'node_modules', '@tanstack', 'db')
  writeJson(join(dbDir, 'package.json'), {
    name: '@tanstack/db',
    version: '0.5.0',
    intent: { version: 1, repo: 'TanStack/db', docs: 'https://db.tanstack.com' },
  })
  writeSkillMd(join(dbDir, 'skills', 'db-core'), {
    name: 'db-core',
    description: 'Core database concepts',
  })

  // Also create root node_modules (empty, typical for pnpm monorepos)
  createDir(root, 'node_modules')

  const result = await scanForIntents(root)
  expect(result.packages).toHaveLength(1)
  expect(result.packages[0]!.name).toBe('@tanstack/db')
  expect(result.packages[0]!.skills).toHaveLength(1)
})
```

Also add a test for `package.json` workspaces (npm/yarn/bun):

```typescript
it('discovers skills in workspace package dependencies using package.json workspaces', async () => {
  writeJson(join(root, 'package.json'), {
    name: 'monorepo',
    private: true,
    workspaces: ['packages/*'],
  })

  const appDir = join(root, 'packages', 'app')
  createDir(root, 'packages', 'app')
  writeJson(join(appDir, 'package.json'), {
    name: '@monorepo/app',
    version: '1.0.0',
    dependencies: { '@tanstack/db': '0.5.0' },
  })

  // In npm/yarn/bun monorepos, deps are hoisted to root node_modules
  const dbDir = join(root, 'node_modules', '@tanstack', 'db')
  writeJson(join(dbDir, 'package.json'), {
    name: '@tanstack/db',
    version: '0.5.0',
    intent: { version: 1, repo: 'TanStack/db', docs: 'https://db.tanstack.com' },
  })
  writeSkillMd(join(dbDir, 'skills', 'db-core'), {
    name: 'db-core',
    description: 'Core database concepts',
  })

  const result = await scanForIntents(root)
  expect(result.packages).toHaveLength(1)
  expect(result.packages[0]!.name).toBe('@tanstack/db')
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm vitest run tests/scanner.test.ts -t "discovers skills in workspace"`
Expected: FAIL — the first test (pnpm-style with workspace package's own node_modules) should fail because the scanner doesn't look at workspace packages' node_modules. The second test (hoisted) may already pass since deps are in root node_modules.

### Task 3: Add workspace scanning phase to scanner.ts

**Files:**
- Modify: `packages/intent/src/scanner.ts`

- [ ] **Step 1: Import workspace resolution functions**

Add to the imports at the top of `scanner.ts`:

```typescript
import {
  readWorkspacePatterns,
  resolveWorkspacePackages,
} from './setup.js'
```

- [ ] **Step 2: Add workspace scanning after Phase 1**

After line 473 (`scanTarget(nodeModules.local)`), add the workspace scanning phase:

```typescript
  // Phase 1b: In monorepos, scan workspace packages' node_modules.
  // This handles pnpm monorepos where each workspace package has its own
  // node_modules with symlinks to its specific dependencies.
  const workspacePatterns = readWorkspacePatterns(projectRoot)
  if (workspacePatterns) {
    for (const wsDir of resolveWorkspacePackages(projectRoot, workspacePatterns)) {
      const wsNodeModules = join(wsDir, 'node_modules')
      if (!existsSync(wsNodeModules)) continue

      for (const dirPath of listNodeModulesPackageDirs(wsNodeModules)) {
        tryRegister(dirPath, 'unknown')
      }
    }
  }
```

- [ ] **Step 3: Run the workspace tests to verify they pass**

Run: `pnpm vitest run tests/scanner.test.ts -t "discovers skills in workspace"`
Expected: PASS

- [ ] **Step 4: Run all scanner tests to verify no regression**

Run: `pnpm vitest run tests/scanner.test.ts`
Expected: All tests pass

- [ ] **Step 5: Commit**

```bash
git add packages/intent/src/scanner.ts packages/intent/tests/scanner.test.ts
git commit -m "feat: scan workspace package dependencies from monorepo root"
```

### Task 4: Clean up Arborist spike

**Files:**
- Delete: `packages/intent/src/scanner-arborist.ts`
- Modify: `packages/intent/package.json` (remove `@npmcli/arborist` devDependency)

- [ ] **Step 1: Delete the spike file**

```bash
rm packages/intent/src/scanner-arborist.ts
```

- [ ] **Step 2: Remove @npmcli/arborist from devDependencies**

Run: `cd packages/intent && pnpm remove @npmcli/arborist`

- [ ] **Step 3: Run all tests**

Run: `pnpm test:lib`
Expected: All tests pass

- [ ] **Step 4: Commit**

```bash
git add packages/intent/src/scanner-arborist.ts packages/intent/package.json ../../pnpm-lock.yaml
git commit -m "chore: remove arborist spike and dependency"
```

---

## Chunk 2: Integration Test Fixtures

### Task 5: Create fixture packages

These are static packages that will be published to the local Verdaccio registry. Each has a `package.json` and optionally `skills/`.

**Files:**
- Create: `packages/intent/tests/fixtures/integration/skills-leaf/package.json`
- Create: `packages/intent/tests/fixtures/integration/skills-leaf/skills/core/SKILL.md`
- Create: `packages/intent/tests/fixtures/integration/wrapper-1/package.json`
- Create: `packages/intent/tests/fixtures/integration/wrapper-2/package.json`
- Create: `packages/intent/tests/fixtures/integration/wrapper-3/package.json`

- [ ] **Step 1: Create the skills-leaf package**

`packages/intent/tests/fixtures/integration/skills-leaf/package.json`:
```json
{
  "name": "@test-intent/skills-leaf",
  "version": "1.0.0",
  "intent": {
    "version": 1,
    "repo": "test/skills-leaf",
    "docs": "https://example.com/docs"
  },
  "files": ["skills"]
}
```

`packages/intent/tests/fixtures/integration/skills-leaf/skills/core/SKILL.md`:
```markdown
---
name: core
description: "Core skill for integration testing"
type: core
---

# Core Skill

This is a test skill used by integration tests.
```

- [ ] **Step 2: Create wrapper-1 (depends on skills-leaf)**

`packages/intent/tests/fixtures/integration/wrapper-1/package.json`:
```json
{
  "name": "@test-intent/wrapper-1",
  "version": "1.0.0",
  "dependencies": {
    "@test-intent/skills-leaf": "1.0.0"
  }
}
```

- [ ] **Step 3: Create wrapper-2 (depends on wrapper-1)**

`packages/intent/tests/fixtures/integration/wrapper-2/package.json`:
```json
{
  "name": "@test-intent/wrapper-2",
  "version": "1.0.0",
  "dependencies": {
    "@test-intent/wrapper-1": "1.0.0"
  }
}
```

- [ ] **Step 4: Create wrapper-3 (depends on wrapper-2)**

`packages/intent/tests/fixtures/integration/wrapper-3/package.json`:
```json
{
  "name": "@test-intent/wrapper-3",
  "version": "1.0.0",
  "dependencies": {
    "@test-intent/wrapper-2": "1.0.0"
  }
}
```

- [ ] **Step 5: Commit**

```bash
git add packages/intent/tests/fixtures/integration/
git commit -m "test: add integration test fixture packages"
```

---

## Chunk 3: Integration Test Infrastructure

### Task 6: Install Verdaccio and create test helpers

**Files:**
- Modify: `packages/intent/package.json` (add verdaccio devDependency)
- Create: `packages/intent/tests/integration/scaffold.ts`

- [ ] **Step 1: Install Verdaccio**

```bash
cd packages/intent && pnpm add -D verdaccio @verdaccio/node-api
```

- [ ] **Step 2: Create the scaffold helper module**

`packages/intent/tests/integration/scaffold.ts`:

```typescript
import { execSync, execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const thisDir = dirname(fileURLToPath(import.meta.url))
const fixturesDir = join(thisDir, '..', 'fixtures', 'integration')
const cliPath = join(thisDir, '..', '..', 'dist', 'cli.mjs')
const realTmpdir = realpathSync(tmpdir())

// ---------------------------------------------------------------------------
// Verdaccio lifecycle
// ---------------------------------------------------------------------------

export interface Registry {
  url: string
  stop: () => void
}

export async function startRegistry(): Promise<Registry> {
  const { runServer } = await import('@verdaccio/node-api')

  const storageDir = mkdtempSync(join(realTmpdir, 'verdaccio-storage-'))
  const port = 6000 + Math.floor(Math.random() * 4000)
  const configPath = join(storageDir, 'config.yaml')

  // Write Verdaccio config file
  writeFileSync(
    configPath,
    [
      `storage: ${storageDir}`,
      'uplinks:',
      '  npmjs:',
      '    url: https://registry.npmjs.org/',
      'packages:',
      "  '@test-intent/*':",
      '    access: $all',
      '    publish: $all',
      "  '**':",
      '    access: $all',
      '    proxy: npmjs',
      'log: { type: stdout, format: pretty, level: fatal }',
    ].join('\n'),
  )

  const app = await runServer(configPath)

  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      const url = `http://localhost:${port}`
      resolve({
        url,
        stop: () => {
          server.close()
          rmSync(storageDir, { recursive: true, force: true })
        },
      })
    })
    server.on('error', reject)
  })
}

// ---------------------------------------------------------------------------
// Publishing fixtures
// ---------------------------------------------------------------------------

export function publishFixtures(registryUrl: string): void {
  const packages = ['skills-leaf', 'wrapper-1', 'wrapper-2', 'wrapper-3']

  for (const pkg of packages) {
    const pkgDir = join(fixturesDir, pkg)
    execSync(`npm publish --registry ${registryUrl} --access public`, {
      cwd: pkgDir,
      stdio: 'ignore',
    })
  }
}

// ---------------------------------------------------------------------------
// Project scaffolding
// ---------------------------------------------------------------------------

export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun'
export type ProjectStructure = 'single' | 'monorepo-root' | 'monorepo-workspace'

interface ScaffoldResult {
  /** Root of the created project */
  root: string
  /** Directory to run the scanner from */
  cwd: string
}

export function scaffoldProject(opts: {
  pm: PackageManager
  structure: ProjectStructure
  dependency: string
  registryUrl: string
}): ScaffoldResult {
  const root = mkdtempSync(join(realTmpdir, `intent-integ-${opts.pm}-`))

  // Create lockfile marker so detectPackageManager works
  const lockfileMap: Record<PackageManager, string> = {
    npm: 'package-lock.json',
    pnpm: 'pnpm-lock.yaml',
    yarn: 'yarn.lock',
    bun: 'bun.lock',
  }
  writeFileSync(join(root, lockfileMap[opts.pm]), '')

  if (opts.structure === 'single') {
    writeJson(join(root, 'package.json'), {
      name: 'test-project',
      private: true,
      dependencies: { [opts.dependency]: '1.0.0' },
    })
    install(root, opts.pm, opts.registryUrl)
    return { root, cwd: root }
  }

  // Monorepo setup
  writeJson(join(root, 'package.json'), {
    name: 'test-monorepo',
    private: true,
    ...(opts.pm !== 'pnpm' ? { workspaces: ['packages/*'] } : {}),
  })
  if (opts.pm === 'pnpm') {
    writeFileSync(
      join(root, 'pnpm-workspace.yaml'),
      'packages:\n  - packages/*\n',
    )
  }
  if (opts.pm === 'yarn') {
    writeFileSync(
      join(root, '.yarnrc.yml'),
      'nodeLinker: node-modules\n',
    )
  }

  const appDir = join(root, 'packages', 'app')
  mkdirSync(appDir, { recursive: true })
  writeJson(join(appDir, 'package.json'), {
    name: '@test/app',
    version: '1.0.0',
    dependencies: { [opts.dependency]: '1.0.0' },
  })

  install(root, opts.pm, opts.registryUrl)

  return {
    root,
    cwd: opts.structure === 'monorepo-root' ? root : appDir,
  }
}

function install(dir: string, pm: PackageManager, registryUrl: string): void {
  const registryArg = `--registry=${registryUrl}`
  const env = { ...process.env, npm_config_registry: registryUrl }

  switch (pm) {
    case 'npm':
      execSync(`npm install ${registryArg}`, { cwd: dir, stdio: 'ignore', env })
      break
    case 'pnpm':
      execSync(`pnpm install ${registryArg} --no-frozen-lockfile`, {
        cwd: dir,
        stdio: 'ignore',
        env,
      })
      break
    case 'yarn':
      execSync(`yarn install ${registryArg}`, { cwd: dir, stdio: 'ignore', env })
      break
    case 'bun':
      execSync(`bun install ${registryArg}`, { cwd: dir, stdio: 'ignore', env })
      break
  }
}

// ---------------------------------------------------------------------------
// CLI invocation
// ---------------------------------------------------------------------------

export interface CliResult {
  stdout: string
  stderr: string
  exitCode: number
  parsed: any
}

export async function runScanner(
  cwd: string,
  method: 'direct' | 'symlink' = 'direct',
): Promise<CliResult> {
  let binPath = cliPath

  if (method === 'symlink') {
    const { symlinkSync } = await import('node:fs')
    const linkDir = mkdtempSync(join(realTmpdir, 'intent-link-'))
    const linkPath = join(linkDir, 'intent-cli.mjs')
    symlinkSync(cliPath, linkPath)
    binPath = linkPath
  }

  try {
    const stdout = execFileSync('node', [binPath, 'list', '--json'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const parsed = JSON.parse(stdout)
    return { stdout, stderr: '', exitCode: 0, parsed }
  } catch (err: any) {
    return {
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? '',
      exitCode: err.status ?? 1,
      parsed: null,
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function writeJson(filePath: string, data: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, JSON.stringify(data, null, 2))
}
```

- [ ] **Step 3: Exclude integration tests from `test:lib` and add `test:integration` script**

In `packages/intent/package.json`, update `scripts`:
```json
"scripts": {
  "test:lib": "vitest run --exclude tests/integration/**",
  "test:integration": "vitest run tests/integration/"
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/intent/package.json packages/intent/tests/integration/scaffold.ts ../../pnpm-lock.yaml
git commit -m "test: add Verdaccio-based integration test infrastructure"
```

---

## Chunk 4: Integration Tests

### Task 7: Write the integration test grid

**Files:**
- Create: `packages/intent/tests/integration/scanner-integration.test.ts`

This test file uses `describe.each` to create the full matrix: 4 package managers × 3 project structures × 4 dependency depths.

- [ ] **Step 1: Write the integration test file**

`packages/intent/tests/integration/scanner-integration.test.ts`:

```typescript
import { rmSync } from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { PackageManager, ProjectStructure, Registry } from './scaffold.js'
import {
  publishFixtures,
  runScanner,
  scaffoldProject,
  startRegistry,
} from './scaffold.js'

// These tests require npm, pnpm, yarn, and bun to be installed.
// They create real projects and install real packages from a local registry.
// Timeout is generous because installs can be slow.

const PACKAGE_MANAGERS: Array<PackageManager> = ['npm', 'pnpm', 'yarn', 'bun']
const STRUCTURES: Array<ProjectStructure> = [
  'single',
  'monorepo-root',
  'monorepo-workspace',
]
const DEPENDENCY_CHAINS: Array<{
  label: string
  dep: string
  transitiveDepth: number
}> = [
  { label: 'direct', dep: '@test-intent/skills-leaf', transitiveDepth: 0 },
  { label: 'transitive+1', dep: '@test-intent/wrapper-1', transitiveDepth: 1 },
  { label: 'transitive+2', dep: '@test-intent/wrapper-2', transitiveDepth: 2 },
  { label: 'transitive+3', dep: '@test-intent/wrapper-3', transitiveDepth: 3 },
]

let registry: Registry
const tempDirs: Array<string> = []

beforeAll(async () => {
  registry = await startRegistry()
  publishFixtures(registry.url)
}, 30_000)

afterAll(() => {
  registry?.stop()
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe.each(PACKAGE_MANAGERS)('package manager: %s', (pm) => {
  describe.each(STRUCTURES)('structure: %s', (structure) => {
    describe.each(DEPENDENCY_CHAINS)(
      'dependency: $label',
      ({ dep }) => {
        it(
          'discovers @test-intent/skills-leaf and its core skill',
          () => {
            const { root, cwd } = scaffoldProject({
              pm,
              structure,
              dependency: dep,
              registryUrl: registry.url,
            })
            tempDirs.push(root)

            const result = await runScanner(cwd)

            expect(result.exitCode).toBe(0)
            expect(result.parsed).toBeTruthy()
            expect(result.parsed.packages).toEqual(
              expect.arrayContaining([
                expect.objectContaining({
                  name: '@test-intent/skills-leaf',
                  version: '1.0.0',
                  skills: expect.arrayContaining([
                    expect.objectContaining({
                      name: 'core',
                      type: 'core',
                    }),
                  ]),
                }),
              ]),
            )
          },
          60_000,
        )
      },
    )
  })
})

// Test that symlink invocation also works (the isMain bug fix)
describe('symlink invocation', () => {
  it('finds skills when CLI is invoked through a symlink', () => {
    const { root, cwd } = scaffoldProject({
      pm: 'npm',
      structure: 'single',
      dependency: '@test-intent/skills-leaf',
      registryUrl: registry.url,
    })
    tempDirs.push(root)

    const result = await runScanner(cwd, 'symlink')

    expect(result.exitCode).toBe(0)
    expect(result.parsed.packages).toHaveLength(1)
    expect(result.parsed.packages[0].name).toBe('@test-intent/skills-leaf')
  }, 60_000)
})
```

- [ ] **Step 2: Build the CLI first (integration tests use the built binary)**

Run: `pnpm run build`

- [ ] **Step 3: Run the integration tests**

Run: `pnpm vitest run tests/integration/scanner-integration.test.ts --test-timeout=120000`

Expected: Tests may take a while (real installs). Debug any failures — likely candidates:
- Yarn may need `.yarnrc.yml` with `nodeLinker: node-modules` in the scaffolded project
- Bun may need special handling
- Transitive depth tests may fail if the scanner doesn't walk deep enough (existing behavior, not a new bug)

Fix any issues in `scaffold.ts` or `scanner.ts` as they arise.

- [ ] **Step 4: Run the full test suite**

Run: `pnpm test:lib`
Expected: All tests pass (both existing unit tests and new integration tests)

- [ ] **Step 5: Commit**

```bash
git add packages/intent/tests/integration/scanner-integration.test.ts
git commit -m "test: add cross-package-manager integration test grid"
```

### Task 8: Handle edge cases discovered during integration testing

This task is intentionally open-ended. During Task 7, some test scenarios may fail revealing real scanner bugs. Common expected issues:

1. **Yarn classic** may need `nodeLinker: node-modules` in `.yarnrc.yml` — add this to `scaffoldProject` when `pm === 'yarn'`
2. **pnpm monorepo transitive deps** — workspace package's transitive deps may not be discovered if the scanner only scans the workspace's direct `node_modules` but doesn't walk deps from there. Solution: after scanning workspace node_modules, also call `walkDeps` on each discovered package.
3. **Bun monorepo workspace detection** — bun uses `package.json` workspaces, should work with existing code

- [ ] **Step 1: Fix any failing test scenarios**

For each failure: identify root cause, fix in scanner.ts or scaffold.ts, verify fix.

- [ ] **Step 2: Run full test suite**

Run: `pnpm test:lib`
Expected: All tests pass

- [ ] **Step 3: Commit fixes**

```bash
git add -A
git commit -m "fix: address integration test edge cases"
```

---

## Chunk 5: Final Verification

### Task 9: End-to-end verification against real monorepo

- [ ] **Step 1: Build the CLI**

Run: `pnpm run build`

- [ ] **Step 2: Test from the monorepo root (the new workspace scanning)**

```bash
cd /Users/kylemathews/programs/darix/.worktrees/ts-darix-runtime
node /Users/kylemathews/programs/intent/packages/intent/dist/cli.mjs list
```

Expected: Should find `@tanstack/db` with 6 skills (new workspace scanning discovers it through workspace packages' node_modules)

- [ ] **Step 4: Test from the workspace package subdir**

```bash
cd /Users/kylemathews/programs/darix/.worktrees/ts-darix-runtime/packages/ts-darix-runtime
node /Users/kylemathews/programs/intent/packages/intent/dist/cli.mjs list
```

Expected: Should find `@tanstack/db` with 6 skills (was already working after the isMain fix)

- [ ] **Step 5: Run full test suite one final time**

Run: `pnpm test:lib`
Expected: All tests pass

- [ ] **Step 6: Commit any remaining changes**

```bash
git add -A
git commit -m "test: verify end-to-end against real monorepo"
```
