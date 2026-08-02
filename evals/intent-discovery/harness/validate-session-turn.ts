import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import type { LiveSessionTurn } from '../corpus/live-sessions'

export type TurnValidation = {
  passed: boolean
  reason: string
}

export function validateSessionTurn(
  workspacePath: string,
  turn: LiveSessionTurn,
): TurnValidation {
  switch (turn.validation) {
    case 'format-display-name':
      return validateFormatDisplayName(workspacePath)
    case 'router':
      return validateRouter(workspacePath)
    case 'sort-user-ids':
      return validateSortUserIds(workspacePath)
    case 'start':
      return validateStart(workspacePath)
    case 'table-v9':
      return validateTable(workspacePath)
  }
}

function validateFormatDisplayName(workspacePath: string): TurnValidation {
  try {
    const exports = evaluateTypeScript(
      join(workspacePath, 'src/lib/format-display-name.ts'),
    )
    const format = exports.formatDisplayName
    const passed =
      typeof format === 'function' &&
      format('  Ada ', ' Lovelace  ') === 'Ada Lovelace' &&
      format('', ' Hopper ') === 'Hopper' &&
      format('  ', ' ') === ''
    return result(passed, 'display-name behavior')
  } catch (error) {
    return result(false, errorMessage(error))
  }
}

function validateSortUserIds(workspacePath: string): TurnValidation {
  try {
    const exports = evaluateTypeScript(
      join(workspacePath, 'src/lib/sort-user-ids.ts'),
    )
    const sort = exports.sortUserIds
    const input = [10, 2, 1]
    const output = typeof sort === 'function' ? sort(input) : null
    const passed =
      Array.isArray(output) &&
      output.join(',') === '1,2,10' &&
      input.join(',') === '10,2,1' &&
      output !== input
    return result(passed, 'numeric immutable sorting behavior')
  } catch (error) {
    return result(false, errorMessage(error))
  }
}

function validateRouter(workspacePath: string): TurnValidation {
  const source = read(workspacePath, 'src/routes/users.$userId.tsx')
  return sourceIncludes(source, [
    ['route loader', /\bloader\s*:/],
    ['parameterized user request', /\/api\/users\/.*userId/],
    ['non-OK response handling', /\b[A-Za-z_$][\w$]*\.ok\b/],
    ['requested error', /Unable to load user/],
    ['loader data consumption', /\buseLoaderData\s*\(/],
  ])
}

function validateStart(workspacePath: string): TurnValidation {
  const source = read(workspacePath, 'src/routes/users.tsx')
  return sourceIncludes(source, [
    ['server function', /createServerFn/],
    ['GET method', /method\s*:\s*['"]GET['"]/],
    ['server handler', /\.handler\s*\(/],
    ['route loader', /\bloader\s*:/],
    ['loader data consumption', /Route\.useLoaderData\(\)/],
  ])
}

function validateTable(workspacePath: string): TurnValidation {
  const source = read(workspacePath, 'src/user-table.tsx')
  return sourceIncludes(source, [
    ['sorting state', /SortingState/],
    ['sorting state update', /onSortingChange/],
    ['controlled sorting state', /state\s*:\s*\{\s*sorting\s*,?\s*\}/],
    ['sorted row model', /getSortedRowModel/],
    ['header sorting handler', /getToggleSortingHandler/],
  ])
}

function evaluateTypeScript(filePath: string): Record<string, unknown> {
  const source = readFileSync(filePath, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const runtimeModule = { exports: {} as Record<string, unknown> }

  Function('module', 'exports', output)(runtimeModule, runtimeModule.exports)

  return runtimeModule.exports
}

function read(workspacePath: string, relativePath: string): string {
  return readFileSync(join(workspacePath, relativePath), 'utf8')
}

function sourceIncludes(
  source: string,
  checks: ReadonlyArray<readonly [string, RegExp]>,
): TurnValidation {
  const missing = checks
    .filter(([, pattern]) => !pattern.test(source))
    .map(([label]) => label)

  return result(missing.length === 0, `missing ${missing.join(', ')}`)
}

function result(passed: boolean, failure: string): TurnValidation {
  return { passed, reason: passed ? 'passed' : failure }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
