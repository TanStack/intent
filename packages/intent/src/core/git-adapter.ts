// Read-only Git adapter for staleness Layer 2 (baseline drift detection).
//
// "Read-only git" is not safe by subcommand alone — git has flags that
// execute external programs even during a read (pagers, textconv/filter
// drivers, inline `-c` config, `--exec-path`). This adapter constrains the
// entire argv per subcommand, never just the subcommand name, and never
// shells out through a string command line.
import { execFileSync } from 'node:child_process'

interface GitAdapterResult<T> {
  ok: true
  value: T
}

interface GitAdapterFailure {
  ok: false
  reason: string
}

export type GitAdapterOutcome<T> = GitAdapterResult<T> | GitAdapterFailure

function ok<T>(value: T): GitAdapterOutcome<T> {
  return { ok: true, value }
}

function fail<T>(reason: string): GitAdapterOutcome<T> {
  return { ok: false, reason }
}

// Forbidden regardless of subcommand: these flags can execute external
// programs or reroute config even on an otherwise-read-only invocation.
const FORBIDDEN_FLAG_PREFIXES = [
  '-c',
  '-C',
  '--exec-path',
  '--textconv',
  '--filters',
]

function assertNoForbiddenFlags(args: ReadonlyArray<string>): void {
  for (const arg of args) {
    for (const forbidden of FORBIDDEN_FLAG_PREFIXES) {
      if (arg === forbidden || arg.startsWith(`${forbidden}=`)) {
        throw new Error(
          `git-adapter: refusing to run with forbidden flag "${arg}".`,
        )
      }
    }
  }
}

// Hardened, fixed leading environment: strips ambient config influence so
// the adapter's behavior doesn't depend on the invoking user's global git
// config, system git config, or a pager.
function hardenedEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_PAGER: 'cat',
    GIT_TERMINAL_PROMPT: '0',
  }
}

// Runs one allowlisted read-only git invocation. `args` must already be a
// fully-formed argv for one of the allowlisted subcommands below — this
// function does not itself decide which subcommands are safe, it only
// enforces the flag blocklist and hardened env universally.
function runGit(
  cwd: string,
  args: ReadonlyArray<string>,
): GitAdapterOutcome<string> {
  assertNoForbiddenFlags(args)

  try {
    const stdout = execFileSync('git', args, {
      cwd,
      env: hardenedEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    })
    return ok(stdout)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return fail(message)
  }
}

// Resolves the working tree root of the repository containing `cwd`, or a
// failure if `cwd` is not inside a git repository.
export function repoRoot(cwd: string): GitAdapterOutcome<string> {
  const result = runGit(cwd, ['rev-parse', '--show-toplevel'])
  if (!result.ok) return result
  return ok(result.value.trim())
}

// Resolves `ref` to a full commit SHA, or a failure if the ref does not
// resolve to a commit (including: not a git repo, ref does not exist).
// Uses `--end-of-options` rather than `--`: in `rev-parse --verify` mode,
// `--` has pathspec-disambiguation semantics that reject a bare rev, while
// `--end-of-options` still guarantees the ref value can't be parsed as a flag.
export function resolveCommit(
  cwd: string,
  ref: string,
): GitAdapterOutcome<string> {
  const result = runGit(cwd, [
    'rev-parse',
    '--verify',
    '--end-of-options',
    `${ref}^{commit}`,
  ])
  if (!result.ok) return result
  return ok(result.value.trim())
}

// Returns the most recent local tag reachable from HEAD, or a failure if
// there is no reachable tag (a distinct outcome from "not a repo").
export function nearestReachableTag(cwd: string): GitAdapterOutcome<string> {
  const result = runGit(cwd, ['describe', '--tags', '--abbrev=0'])
  if (!result.ok) return result
  const tag = result.value.trim()
  if (tag.length === 0) {
    return fail('git-adapter: no reachable tag found.')
  }
  return ok(tag)
}

// Returns the git blob SHA for `relPath` as it existed at `commit`, or null
// if the path did not exist in that commit's tree (not an error — the file
// may simply be new since the baseline).
export function blobShaAtCommit(
  cwd: string,
  commit: string,
  relPath: string,
): GitAdapterOutcome<string | null> {
  const result = runGit(cwd, ['ls-tree', commit, '--', relPath])
  if (!result.ok) return result

  const line = result.value.trim()
  if (line.length === 0) return ok(null)

  // Format: "<mode> <type> <sha>\t<path>"
  const match = /^\d+\s+\w+\s+([0-9a-f]+)\t/.exec(line)
  if (!match) {
    return fail(`git-adapter: unrecognized ls-tree output for "${relPath}".`)
  }
  return ok(match[1] ?? null)
}

// Computes the git blob SHA git would assign to the current working-tree
// contents of `relPath`, without writing anything to the object database
// (no `-w`). Returns null if the file does not exist on disk.
export function currentBlobSha(
  cwd: string,
  relPath: string,
): GitAdapterOutcome<string | null> {
  const result = runGit(cwd, ['hash-object', '--', relPath])
  if (!result.ok) {
    // hash-object fails with a non-zero exit when the path does not exist;
    // treat that as "no current content" rather than an adapter failure.
    return ok(null)
  }
  return ok(result.value.trim())
}
