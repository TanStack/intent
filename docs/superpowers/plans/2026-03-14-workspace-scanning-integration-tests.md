# Workspace-Aware Scanning & Integration Tests

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the scanner discover skills from workspace packages when run from a monorepo root, fix dep resolution for hoisted workspace layouts, and add integration tests with Verdaccio that verify scanning across all package managers (npm, pnpm, yarn, bun), project structures (single, monorepo root, monorepo workspace), and dependency depths (direct, transitive+1/+2/+3).

**Architecture:** Three scanner changes: (1) replace `resolveDepDir` with Node's `createRequire` for dependency resolution — this naturally handles hoisted deps, pnpm symlinks, and workspace layouts because Node already walks up the directory tree; (2) add a workspace-aware phase that discovers workspace packages via `pnpm-workspace.yaml` / `package.json#workspaces` and walks their dependencies to find transitive skills packages; (3) export `resolveWorkspacePackages` from `setup.ts`. For integration tests, use Verdaccio (local npm registry) to publish fixture packages, then create real projects with each package manager, install deps, and run the scanner. Follows Knip's pattern: use workspace config to find packages, use Node's built-in module resolution for dep lookup.

**Tech Stack:** Vitest, Verdaccio / @verdaccio/node-api (dev dependency), npm/pnpm/yarn/bun CLIs

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/intent/src/utils.ts` | Modify | Replace `resolveDepDir` with `createRequire`-based resolution, remove `listNodeModulesPackageDirs`, `getDeps`, `detectGlobalNodeModules` |
| `packages/intent/src/setup.ts` | Modify | Export `resolveWorkspacePackages` |
| `packages/intent/src/scanner.ts` | Modify | Use new `resolveDepDir`, add workspace scanning phase, simplify by removing multi-phase scanning |
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

## Chunk 1: Replace resolveDepDir with createRequire

### Task 1: Replace `resolveDepDir` in utils.ts

The current `resolveDepDir` has a hand-rolled 3-layer resolution strategy (hoisted check, nested check, pnpm virtual store walk-up). Node's `createRequire` handles all of these — plus upward workspace-root walks — in one call.

**Files:**
- Modify: `packages/intent/src/utils.ts:146-199`

- [ ] **Step 1: Write the failing test for the new behavior**

The existing scanner tests already exercise `resolveDepDir` indirectly through `scanForIntents`. We'll verify the new resolution by adding a test that proves workspace-hoisted deps are found when scanning from a workspace package subdir. Add to `scanner.test.ts`:

```typescript
it('finds hoisted deps when scanning from a workspace package subdir', async () => {
  // Simulate npm/yarn/bun monorepo: deps hoisted to root node_modules
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

  // Dep is hoisted to root, NOT in app's node_modules
  createDir(root, 'node_modules', '@tanstack', 'db')
  createDir(root, 'node_modules', '@tanstack', 'db', 'skills', 'db-core')
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

  // Scan from the workspace package subdir (not root)
  const result = await scanForIntents(appDir)
  expect(result.packages).toHaveLength(1)
  expect(result.packages[0]!.name).toBe('@tanstack/db')
})
```

Run: `pnpm vitest run tests/scanner.test.ts -t "finds hoisted deps"`
Expected: FAIL — current `resolveDepDir` only checks explicit `resolutionRoots`, not upward walk.

- [ ] **Step 2: Replace `resolveDepDir` in utils.ts**

Replace the existing `resolveDepDir` function (lines 146-199 of `utils.ts`) with:

```typescript
import { createRequire } from 'node:module'

/**
 * Resolve the directory of a dependency by name. Uses Node's built-in
 * module resolution via createRequire, which handles:
 * - Hoisted layouts (npm, yarn, bun) — walks up directory tree
 * - pnpm symlinked virtual store — follows symlinks
 * - Workspace packages — finds deps at workspace root
 * - Nested node_modules — standard Node resolution
 */
export function resolveDepDir(
  depName: string,
  parentDir: string,
): string | null {
  try {
    const require = createRequire(join(parentDir, 'package.json'))
    const pkgJsonPath = require.resolve(join(depName, 'package.json'))
    return dirname(pkgJsonPath)
  } catch {
    return null
  }
}
```

Also remove these functions that are no longer needed:
- `listNodeModulesPackageDirs` (scanner will scan via workspace resolution + dep walking instead)
- `detectGlobalNodeModules` (no longer used — `createRequire` finds global installs naturally)

Keep `getDeps` — still needed to extract dep names from package.json.
Keep `findSkillFiles`, `parseFrontmatter`.

- [ ] **Step 3: Update scanner.ts call sites**

The `resolveDepDir` signature changed from 4 args to 2. Update `walkDeps` in scanner.ts:

```typescript
// Before:
const depDir = resolveDepDir(depName, pkgDir, pkgName, resolutionRoots)

// After:
const depDir = resolveDepDir(depName, pkgDir)
```

And `walkProjectDeps`:
```typescript
// Before:
const depDir = resolveDepDir(depName, projectRoot, depName, resolutionRoots)

// After:
const depDir = resolveDepDir(depName, projectRoot)
```

Remove the `resolutionRoots` array and all code that builds/manages it. Remove `scanTarget`, `ensureGlobalNodeModules`, and the `nodeModules.global` scanning phases. The scanner simplifies to:

1. Scan `node_modules` at project root for packages with `skills/`
2. Walk project deps
3. Walk known packages' deps
4. (New) Workspace scanning

- [ ] **Step 4: Run all tests**

Run: `pnpm vitest run tests/scanner.test.ts`
Expected: Most tests pass. The global node_modules tests will need updating since we removed that feature. If any tests relied on `listNodeModulesPackageDirs` or the old `resolveDepDir` signature, update them.

- [ ] **Step 5: Commit**

```bash
git add packages/intent/src/utils.ts packages/intent/src/scanner.ts packages/intent/tests/scanner.test.ts
git commit -m "refactor: replace resolveDepDir with createRequire-based resolution"
```

---

## Chunk 2: Workspace Scanning

### Task 2: Export `resolveWorkspacePackages` from setup.ts

**Files:**
- Modify: `packages/intent/src/setup.ts:483`

- [ ] **Step 1: Make `resolveWorkspacePackages` exported**

Change `function resolveWorkspacePackages(` to `export function resolveWorkspacePackages(` in setup.ts.

- [ ] **Step 2: Commit**

```bash
git add packages/intent/src/setup.ts
git commit -m "refactor: export resolveWorkspacePackages from setup.ts"
```

### Task 3: Write failing tests for workspace scanning

**Files:**
- Modify: `packages/intent/tests/scanner.test.ts`

- [ ] **Step 1: Write tests for pnpm-style workspace and transitive deps**

```typescript
it('discovers skills in workspace package dependencies from monorepo root', async () => {
  writeFileSync(
    join(root, 'pnpm-workspace.yaml'),
    'packages:\n  - packages/*\n',
  )
  writeJson(join(root, 'package.json'), {
    name: 'monorepo',
    private: true,
  })

  const appDir = join(root, 'packages', 'app')
  createDir(root, 'packages', 'app')
  writeJson(join(appDir, 'package.json'), {
    name: '@monorepo/app',
    version: '1.0.0',
    dependencies: { '@tanstack/db': '0.5.0' },
  })

  createDir(appDir, 'node_modules', '@tanstack', 'db')
  createDir(appDir, 'node_modules', '@tanstack', 'db', 'skills', 'db-core')
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

  createDir(root, 'node_modules')

  const result = await scanForIntents(root)
  expect(result.packages).toHaveLength(1)
  expect(result.packages[0]!.name).toBe('@tanstack/db')
  expect(result.packages[0]!.skills).toHaveLength(1)
})

it('discovers transitive skills through workspace package deps', async () => {
  writeFileSync(
    join(root, 'pnpm-workspace.yaml'),
    'packages:\n  - packages/*\n',
  )
  writeJson(join(root, 'package.json'), {
    name: 'monorepo',
    private: true,
  })

  const appDir = join(root, 'packages', 'app')
  createDir(root, 'packages', 'app')
  writeJson(join(appDir, 'package.json'), {
    name: '@monorepo/app',
    version: '1.0.0',
    dependencies: { 'wrapper': '1.0.0' },
  })

  // wrapper has no skills, but depends on skills-pkg
  createDir(appDir, 'node_modules', 'wrapper')
  writeJson(join(appDir, 'node_modules', 'wrapper', 'package.json'), {
    name: 'wrapper',
    version: '1.0.0',
    dependencies: { 'skills-pkg': '1.0.0' },
  })

  // skills-pkg is a transitive dep (sibling in node_modules)
  createDir(appDir, 'node_modules', 'skills-pkg')
  createDir(appDir, 'node_modules', 'skills-pkg', 'skills', 'core')
  writeJson(join(appDir, 'node_modules', 'skills-pkg', 'package.json'), {
    name: 'skills-pkg',
    version: '1.0.0',
    intent: { version: 1, repo: 'test/skills', docs: 'https://example.com' },
  })
  writeSkillMd(join(appDir, 'node_modules', 'skills-pkg', 'skills', 'core'), {
    name: 'core',
    description: 'Core skill',
  })

  createDir(root, 'node_modules')

  const result = await scanForIntents(root)
  expect(result.packages).toHaveLength(1)
  expect(result.packages[0]!.name).toBe('skills-pkg')
})

it('discovers skills using package.json workspaces', async () => {
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

  createDir(root, 'node_modules', '@tanstack', 'db')
  createDir(root, 'node_modules', '@tanstack', 'db', 'skills', 'db-core')
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
Expected: FAIL — scanner doesn't scan workspace packages' node_modules yet.

### Task 4: Add workspace scanning phase to scanner.ts

**Files:**
- Modify: `packages/intent/src/scanner.ts`

- [ ] **Step 1: Import workspace resolution functions**

```typescript
import {
  readWorkspacePatterns,
  resolveWorkspacePackages,
} from './setup.js'
```

- [ ] **Step 2: Add workspace scanning phase**

After the existing Phase 1 (`scanTarget`), and after the `walkDeps`/`walkKnownPackages`/`walkProjectDeps` function definitions, add workspace scanning before the first `walkKnownPackages()` call:

```typescript
  // Phase 1b: In monorepos, discover workspace packages and walk their deps.
  // This handles pnpm monorepos (workspace-specific node_modules) and ensures
  // transitive skills packages are found through workspace package dependencies.
  const workspacePatterns = readWorkspacePatterns(projectRoot)
  if (workspacePatterns) {
    for (const wsDir of resolveWorkspacePackages(projectRoot, workspacePatterns)) {
      // Scan workspace package's own node_modules for skills
      const wsNodeModules = join(wsDir, 'node_modules')
      if (existsSync(wsNodeModules)) {
        for (const dirPath of listNodeModulesPackageDirs(wsNodeModules)) {
          tryRegister(dirPath, 'unknown')
        }
      }

      // Walk workspace package's deps to find transitive skills packages.
      // createRequire-based resolveDepDir walks up from wsDir, so it finds
      // deps hoisted to the monorepo root too.
      const wsPkg = readPkgJson(wsDir)
      if (wsPkg) {
        const wsName = typeof wsPkg.name === 'string' ? wsPkg.name : 'unknown'
        for (const depName of getDeps(wsPkg, true)) {
          const depDir = resolveDepDir(depName, wsDir)
          if (depDir && !walkVisited.has(depDir)) {
            tryRegister(depDir, depName)
            walkDeps(depDir, depName)
          }
        }
      }
    }
  }
```

Note: keep `listNodeModulesPackageDirs` for the top-level scan (Phase 1) and workspace node_modules scan — it's still the right tool for "scan everything in this directory." The `createRequire` change is for `resolveDepDir` (resolving a specific dep by name from a parent).

- [ ] **Step 3: Run workspace tests**

Run: `pnpm vitest run tests/scanner.test.ts -t "workspace\|hoisted"`
Expected: PASS

- [ ] **Step 4: Run all scanner tests**

Run: `pnpm vitest run tests/scanner.test.ts`
Expected: All pass

- [ ] **Step 5: Commit**

```bash
git add packages/intent/src/scanner.ts packages/intent/tests/scanner.test.ts
git commit -m "feat: scan workspace package dependencies from monorepo root

Uses readWorkspacePatterns to discover workspace packages, then scans their
node_modules and walks their dependency trees. createRequire-based
resolveDepDir naturally finds deps hoisted to the workspace root."
```

### Task 5: Clean up Arborist spike

**Files:**
- Delete: `packages/intent/src/scanner-arborist.ts`
- Modify: `packages/intent/package.json`

- [ ] **Step 1: Delete spike and remove dependency**

```bash
rm packages/intent/src/scanner-arborist.ts
cd packages/intent && pnpm remove @npmcli/arborist
```

- [ ] **Step 2: Run all tests**

Run: `pnpm test:lib`
Expected: All pass

- [ ] **Step 3: Commit**

```bash
git add packages/intent/src/scanner-arborist.ts packages/intent/package.json ../../pnpm-lock.yaml
git commit -m "chore: remove arborist spike and dependency"
```

---

## Chunk 3: Integration Test Fixtures & Infrastructure

### Task 6: Create fixture packages

**Files:**
- Create: `packages/intent/tests/fixtures/integration/skills-leaf/package.json`
- Create: `packages/intent/tests/fixtures/integration/skills-leaf/skills/core/SKILL.md`
- Create: `packages/intent/tests/fixtures/integration/wrapper-1/package.json`
- Create: `packages/intent/tests/fixtures/integration/wrapper-2/package.json`
- Create: `packages/intent/tests/fixtures/integration/wrapper-3/package.json`

- [ ] **Step 1: Create all fixture packages**

`skills-leaf/package.json`:
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

`skills-leaf/skills/core/SKILL.md`:
```markdown
---
name: core
description: "Core skill for integration testing"
type: core
---

# Core Skill

This is a test skill used by integration tests.
```

`wrapper-1/package.json`:
```json
{
  "name": "@test-intent/wrapper-1",
  "version": "1.0.0",
  "dependencies": { "@test-intent/skills-leaf": "1.0.0" }
}
```

`wrapper-2/package.json`:
```json
{
  "name": "@test-intent/wrapper-2",
  "version": "1.0.0",
  "dependencies": { "@test-intent/wrapper-1": "1.0.0" }
}
```

`wrapper-3/package.json`:
```json
{
  "name": "@test-intent/wrapper-3",
  "version": "1.0.0",
  "dependencies": { "@test-intent/wrapper-2": "1.0.0" }
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/intent/tests/fixtures/integration/
git commit -m "test: add integration test fixture packages"
```

### Task 7: Install Verdaccio and create scaffold helpers

**Files:**
- Modify: `packages/intent/package.json`
- Create: `packages/intent/tests/integration/scaffold.ts`

- [ ] **Step 1: Install Verdaccio**

```bash
cd packages/intent && pnpm add -D verdaccio @verdaccio/node-api
```

- [ ] **Step 2: Create scaffold.ts**

`packages/intent/tests/integration/scaffold.ts`:

```typescript
import { execSync, execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
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
      resolve({
        url: `http://localhost:${port}`,
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
  // Order matters: leaf first, then wrappers that depend on it
  for (const pkg of ['skills-leaf', 'wrapper-1', 'wrapper-2', 'wrapper-3']) {
    execSync(`npm publish --registry ${registryUrl} --access public`, {
      cwd: join(fixturesDir, pkg),
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
  root: string
  cwd: string
}

export function scaffoldProject(opts: {
  pm: PackageManager
  structure: ProjectStructure
  dependency: string
  registryUrl: string
}): ScaffoldResult {
  const root = mkdtempSync(join(realTmpdir, `intent-integ-${opts.pm}-`))

  // Lockfile marker so detectPackageManager works
  const lockfiles: Record<PackageManager, string> = {
    npm: 'package-lock.json',
    pnpm: 'pnpm-lock.yaml',
    yarn: 'yarn.lock',
    bun: 'bun.lock',
  }
  writeFileSync(join(root, lockfiles[opts.pm]), '')

  if (opts.structure === 'single') {
    writeJson(join(root, 'package.json'), {
      name: 'test-project',
      private: true,
      dependencies: { [opts.dependency]: '1.0.0' },
    })
    install(root, opts.pm, opts.registryUrl)
    return { root, cwd: root }
  }

  // Monorepo
  writeJson(join(root, 'package.json'), {
    name: 'test-monorepo',
    private: true,
    ...(opts.pm !== 'pnpm' ? { workspaces: ['packages/*'] } : {}),
  })
  if (opts.pm === 'pnpm') {
    writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n')
  }
  if (opts.pm === 'yarn') {
    writeFileSync(join(root, '.yarnrc.yml'), 'nodeLinker: node-modules\n')
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
  const env = { ...process.env, npm_config_registry: registryUrl }
  const reg = `--registry=${registryUrl}`

  switch (pm) {
    case 'npm':
      execSync(`npm install ${reg}`, { cwd: dir, stdio: 'ignore', env })
      break
    case 'pnpm':
      execSync(`pnpm install ${reg} --no-frozen-lockfile`, { cwd: dir, stdio: 'ignore', env })
      break
    case 'yarn':
      execSync(`yarn install ${reg}`, { cwd: dir, stdio: 'ignore', env })
      break
    case 'bun':
      execSync(`bun install ${reg}`, { cwd: dir, stdio: 'ignore', env })
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

export function runScanner(
  cwd: string,
  method: 'direct' | 'symlink' = 'direct',
): CliResult {
  let binPath = cliPath

  if (method === 'symlink') {
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
    return { stdout, stderr: '', exitCode: 0, parsed: JSON.parse(stdout) }
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

- [ ] **Step 3: Exclude integration tests from `test:lib`, add `test:integration`**

In `packages/intent/package.json`, update scripts:
```json
"test:lib": "vitest run --exclude tests/integration/**",
"test:integration": "vitest run tests/integration/"
```

- [ ] **Step 4: Commit**

```bash
git add packages/intent/package.json packages/intent/tests/integration/scaffold.ts ../../pnpm-lock.yaml
git commit -m "test: add Verdaccio-based integration test infrastructure"
```

---

## Chunk 4: Integration Test Grid

### Task 8: Write the integration test matrix

**Files:**
- Create: `packages/intent/tests/integration/scanner-integration.test.ts`

- [ ] **Step 1: Write the test file**

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

const PACKAGE_MANAGERS: Array<PackageManager> = ['npm', 'pnpm', 'yarn', 'bun']
const STRUCTURES: Array<ProjectStructure> = [
  'single',
  'monorepo-root',
  'monorepo-workspace',
]
const DEPENDENCY_CHAINS: Array<{ label: string; dep: string }> = [
  { label: 'direct', dep: '@test-intent/skills-leaf' },
  { label: 'transitive+1', dep: '@test-intent/wrapper-1' },
  { label: 'transitive+2', dep: '@test-intent/wrapper-2' },
  { label: 'transitive+3', dep: '@test-intent/wrapper-3' },
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
    describe.each(DEPENDENCY_CHAINS)('dependency: $label', ({ dep }) => {
      it('discovers @test-intent/skills-leaf and its core skill', () => {
        const { root, cwd } = scaffoldProject({
          pm,
          structure,
          dependency: dep,
          registryUrl: registry.url,
        })
        tempDirs.push(root)

        const result = runScanner(cwd)

        expect(result.exitCode).toBe(0)
        expect(result.parsed).toBeTruthy()
        expect(result.parsed.packages).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              name: '@test-intent/skills-leaf',
              version: '1.0.0',
              skills: expect.arrayContaining([
                expect.objectContaining({ name: 'core', type: 'core' }),
              ]),
            }),
          ]),
        )
      }, 60_000)
    })
  })
})

describe('symlink invocation', () => {
  it('finds skills when CLI is invoked through a symlink', () => {
    const { root, cwd } = scaffoldProject({
      pm: 'npm',
      structure: 'single',
      dependency: '@test-intent/skills-leaf',
      registryUrl: registry.url,
    })
    tempDirs.push(root)

    const result = runScanner(cwd, 'symlink')

    expect(result.exitCode).toBe(0)
    expect(result.parsed.packages).toHaveLength(1)
    expect(result.parsed.packages[0].name).toBe('@test-intent/skills-leaf')
  }, 60_000)
})
```

- [ ] **Step 2: Build CLI and run integration tests**

```bash
pnpm run build
pnpm test:integration
```

Expected: 4 PMs × 3 structures × 4 depths = 48 tests + 1 symlink test = 49 total. Debug failures as they arise (Task 9).

- [ ] **Step 3: Commit**

```bash
git add packages/intent/tests/integration/scanner-integration.test.ts
git commit -m "test: add cross-package-manager integration test grid (49 scenarios)"
```

### Task 9: Fix edge cases from integration testing

Debug and fix failures. Common issues:
1. **Yarn Berry PnP** — `.yarnrc.yml` with `nodeLinker: node-modules` already added in scaffold
2. **pnpm transitive deps** — `createRequire` + workspace dep walking should handle this; if not, debug the resolution chain
3. **Bun workspaces** — uses `package.json` workspaces, should work

- [ ] **Step 1: Fix failures, run `pnpm test:lib && pnpm test:integration`**
- [ ] **Step 2: Commit fixes**

---

## Chunk 5: Final Verification

### Task 10: End-to-end against real monorepo

- [ ] **Step 1: Build CLI**

```bash
pnpm run build
```

- [ ] **Step 2: Test from monorepo root**

```bash
cd /Users/kylemathews/programs/darix/.worktrees/ts-darix-runtime
node /Users/kylemathews/programs/intent/packages/intent/dist/cli.mjs list
```

Expected: `@tanstack/db` with 6 skills (workspace scanning)

- [ ] **Step 3: Test from workspace package subdir**

```bash
cd /Users/kylemathews/programs/darix/.worktrees/ts-darix-runtime/packages/ts-darix-runtime
node /Users/kylemathews/programs/intent/packages/intent/dist/cli.mjs list
```

Expected: `@tanstack/db` with 6 skills (createRequire walks up to root node_modules)

- [ ] **Step 4: Run `pnpm test:lib && pnpm test:integration`**

Expected: All unit + integration tests pass

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "test: verify end-to-end against real monorepo"
```
