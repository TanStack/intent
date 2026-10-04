import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveProjectContext } from '../core/project-context.js'
import { resolveWorkspacePackages } from '../setup/workspace-patterns.js'
import { parseFrontmatter, readScalarField } from '../shared/utils.js'
import type TS from 'typescript'
import type * as NativeApi from 'typescript7/unstable/async'
import type * as NativeAst from 'typescript7/unstable/ast'
import type * as NativeIs from 'typescript7/unstable/ast/is'
import type * as NativeScanner from 'typescript7/unstable/ast/scanner'

interface SkillBlockFinding {
  file: string
  line: number
  message: string
  severity: 'error' | 'warning'
}

export interface SkillBlockCheck {
  blocks: number
  findings: Array<SkillBlockFinding>
  // Set when the code blocks could not be typechecked; links are still checked.
  skipped?: string
}

interface CodeBlock {
  file: string
  line: number
  code: string
  // Virtual file extension: a plain ts block must not parse as JSX, or a
  // generic arrow like <T>(x: T) => x reads as an unclosed element.
  extension: 'ts' | 'tsx' | 'js' | 'jsx'
}

// Scan whole fences before selecting languages: a Markdown example can contain
// shorter fences, closing fences may be longer, and EOF also closes a fence.
function codeFences(content: string) {
  const lines = content.split(/\r?\n/)
  const fences: Array<{
    start: number
    end: number
    language: string
    code: string
  }> = []
  for (let start = 0; start < lines.length; start++) {
    const opening = /^( {0,3})(`{3,}|~{3,})(.*)$/.exec(lines[start]!)
    if (!opening || (opening[2]![0] === '`' && opening[3]!.includes('`')))
      continue
    const marker = opening[2]!
    let end = start + 1
    for (; end < lines.length; end++) {
      const closing = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(lines[end]!)
      if (
        closing &&
        closing[1]![0] === marker[0] &&
        closing[1]!.length >= marker.length
      )
        break
    }
    const dedent = new RegExp(`^ {0,${opening[1]!.length}}`)
    fences.push({
      start,
      end,
      language: opening[3]!.trim().split(/\s+/)[0]!.toLowerCase(),
      code: lines
        .slice(start + 1, end)
        .map((line) => line.replace(dedent, ''))
        .join('\n'),
    })
    start = end
  }
  return fences
}
const checkedLanguages = new Set([
  'ts',
  'tsx',
  'typescript',
  'js',
  'jsx',
  'javascript',
])
// A destination is either <...>, which may contain spaces, or a bare path.
const markdownLink = /\[[^\]]*\]\((?:<([^>]*)>|([^)\s]+))(?:\s+"[^"]*")?\)/g

// Diagnostics that a deliberately partial example produces: names, modules,
// and globals the snippet leaves out. Everything else describes the library
// contract or a genuinely broken example.
const partialSnippetCodes = new Set([
  1375, 2304, 2318, 2503, 2552, 2580, 2581, 2582, 2583, 2584, 2591, 2592, 2593,
  2602, 2686, 2688, 7006, 7026, 7031, 17004, 18004,
])
const missingModuleCodes = new Set([2307, 2792])

// In tsconfig form, so both compiler APIs check examples with the same options.
const exampleCompilerOptions = {
  noEmit: true,
  strict: false,
  // Router and other conditional APIs require null and undefined to stay
  // distinct. Partial examples still tolerate omitted names and implicit any.
  strictNullChecks: true,
  skipLibCheck: true,
  allowJs: true,
  checkJs: true,
  resolveJsonModule: true,
  esModuleInterop: true,
  allowSyntheticDefaultImports: true,
  target: 'esnext',
  module: 'esnext',
  // Each fence is a standalone example, even when it has no imports.
  moduleDetection: 'force',
  moduleResolution: 'bundler',
  jsx: 'preserve',
  lib: ['esnext', 'dom'],
  types: [],
}

// TypeScript 7 publishes its compiler API only under these unstable entries.
interface NativeTypeScript {
  api: typeof NativeApi
  ast: typeof NativeAst
  is: typeof NativeIs
  scanner: typeof NativeScanner
}
type NativeProject = NonNullable<ReturnType<NativeApi.Snapshot['getProject']>>
type NativeDiagnostic = Awaited<
  ReturnType<NativeProject['program']['getSemanticDiagnostics']>
>[number]

function loadTypeScript(root: string): typeof TS | null {
  for (const from of [join(root, 'package.json'), import.meta.url]) {
    const load = createRequire(from)
    let ts: typeof TS
    try {
      ts = load('typescript') as typeof TS
    } catch {
      continue // Try the next location.
    }
    if (hasCompilerApi(ts)) return ts
    // TypeScript 7 exports no compiler API. Its documented side-by-side
    // package keeps the TypeScript 6 API installed next to it.
    try {
      return load('@typescript/typescript6') as typeof TS
    } catch {
      return ts
    }
  }
  return null
}

// A version check is not enough: TypeScript 7 passes the 5.0 minimum but its
// package root exports only version fields, not the compiler API.
const hasCompilerApi = (ts: typeof TS) => typeof ts.createProgram === 'function'

// These entries are ES modules. They are imported by the path they resolve
// to from the repository, so the repository's TypeScript is used rather than
// one installed near Intent.
async function loadNativeTypeScript(
  root: string,
): Promise<NativeTypeScript | null> {
  for (const from of [join(root, 'package.json'), import.meta.url]) {
    const load = createRequire(from)
    const entry = (name: string) =>
      import(pathToFileURL(load.resolve(`typescript/unstable/${name}`)).href)
    try {
      return {
        api: await entry('async'),
        ast: await entry('ast'),
        is: await entry('ast/is'),
        scanner: await entry('ast/scanner'),
      }
    } catch {
      // Try the next location.
    }
  }
  return null
}

// TypeScript 7 compiles in a separate process. Examples reach it as virtual
// files listed by a virtual project configuration, so nothing is written.
async function withNativeCompiler<T>(
  native: NativeTypeScript,
  root: string,
  virtualDir: string,
  run: (
    open: (
      sources: Map<string, string>,
      compilerOptions: Record<string, unknown>,
    ) => Promise<NativeProject>,
  ) => Promise<T>,
): Promise<T> {
  const files = new Map<string, string>()
  let projects = 0
  const api = new native.api.API({
    cwd: root,
    // Answers for virtual paths; undefined falls back to the real file system
    // for library sources and node_modules. The virtual directory is not on
    // disk, so it and its parents are reported as existing. Paths are keyed
    // with forward slashes whatever separator the compiler process uses.
    fs: {
      readFile: (path) => files.get(slash(path)),
      fileExists: (path) => files.has(slash(path)) || undefined,
      directoryExists: (path) =>
        `${virtualDir}/`.startsWith(`${slash(path)}/`) || undefined,
    },
  })
  try {
    return await run(async (sources, compilerOptions) => {
      // A new configuration per call opens a new project that lists only
      // this call's files, whatever the compiler process kept from earlier.
      const config = `${virtualDir}/tsconfig-${projects++}.json`
      for (const [path, code] of sources) files.set(path, code)
      files.set(
        config,
        JSON.stringify({ compilerOptions, files: [...sources.keys()] }),
      )
      const snapshot = await api.updateSnapshot({ openProjects: [config] })
      const project = snapshot.getProject(config)
      if (!project) throw new Error(`could not open ${config}`)
      return project
    })
  } finally {
    await api.close()
  }
}

// The same text as flattenDiagnosticMessageText(messageText, ' ') in the
// TypeScript 6 API.
function nativeMessage(diagnostic: NativeDiagnostic, indent = 0): string {
  return [
    `${indent ? ` ${'  '.repeat(indent)}` : ''}${diagnostic.text}`,
    ...(diagnostic.messageChain ?? []).map((next) =>
      nativeMessage(next, indent + 1),
    ),
  ].join('')
}

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

function extractCodeBlocks(file: string, content: string): Array<CodeBlock> {
  const blocks: Array<CodeBlock> = []
  for (const fence of codeFences(content)) {
    const language = fence.language
    if (!checkedLanguages.has(language)) continue
    const line = fence.start + 2
    const extension =
      language === 'tsx' || language === 'jsx'
        ? language
        : language.startsWith('j')
          ? 'js'
          : 'ts'
    blocks.push({ file, line, code: fence.code, extension })
  }
  return blocks
}

// Parsing for example repair suggestions, from either compiler API.
interface ExampleParser {
  // Full start of each top-level statement, including leading comments.
  statements: (filename: string, code: string) => Promise<Array<number>>
  comments: (
    code: string,
    position: number,
  ) => ReadonlyArray<{ pos: number; end: number }>
  parses: (filename: string, code: string) => Promise<boolean>
}

function typeScriptParser(ts: typeof TS): ExampleParser {
  return {
    statements: (filename, code) =>
      Promise.resolve(
        ts
          .createSourceFile(filename, code, ts.ScriptTarget.Latest, true)
          .statements.map((statement) => statement.pos),
      ),
    comments: (code, position) =>
      ts.getLeadingCommentRanges(code, position) ?? [],
    parses: (filename, code) =>
      Promise.resolve(
        !(
          ts.transpileModule(code, {
            fileName: filename,
            reportDiagnostics: true,
            compilerOptions: {
              target: ts.ScriptTarget.ESNext,
              module: ts.ModuleKind.ESNext,
              jsx: ts.JsxEmit.Preserve,
            },
          }).diagnostics ?? []
        ).some(
          (diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error,
        ),
      ),
  }
}

function nativeParser(
  native: NativeTypeScript,
  virtualDir: string,
  open: Parameters<Parameters<typeof withNativeCompiler>[3]>[0],
): ExampleParser {
  let files = 0
  const program = async (filename: string, code: string) => {
    // A new name per parse, so no parse depends on whether the compiler
    // process re-reads a path it has already read. The filename keeps the
    // extension, which decides whether the code parses as JSX.
    const path = `${virtualDir}/${files++}-${filename}`
    const project = await open(new Map([[path, code]]), exampleCompilerOptions)
    return { path, program: project.program }
  }
  return {
    statements: async (filename, code) => {
      const { path, program: parsed } = await program(filename, code)
      const source = await parsed.getSourceFile(path)
      if (!source) throw new Error(`could not read ${path}`)
      return source.statements.map((statement) => statement.pos)
    },
    comments: (code, position) =>
      native.scanner.getLeadingCommentRanges(code, position) ?? [],
    parses: async (filename, code) => {
      const { path, program: parsed } = await program(filename, code)
      return !(await parsed.getSyntacticDiagnostics(path)).some(
        (diagnostic) =>
          diagnostic.category === native.api.DiagnosticCategory.Error,
      )
    },
  }
}

// These are suggestions for review, not automatic fixes: BEFORE/AFTER can
// describe sequential work as well as alternative implementations.
export async function planExampleRepairs(
  root: string,
  content: string,
): Promise<{
  content: string
  suggestions: Array<{ line: number; message: string }>
  skipped?: string
}> {
  const lines = content.split(/(?<=\n)/)
  const fences = codeFences(content)
    .reverse()
    .filter(
      (fence) =>
        checkedLanguages.has(fence.language) &&
        fence.end < lines.length &&
        /^\s*\/\/\s*BEFORE\b/i.test(fence.code) &&
        /\/\/\s*AFTER\b/i.test(fence.code),
    )
  if (!fences.length) return { content, suggestions: [] }
  const skip = (skipped: string) => ({ content, suggestions: [], skipped })
  const ts = loadTypeScript(root)
  if (!ts || Number(ts.versionMajorMinor.split('.')[0]) < 5)
    return skip(
      'TypeScript 5.0 or newer is required to suggest example repairs.',
    )
  if (hasCompilerApi(ts))
    return splitExamples(lines, fences, typeScriptParser(ts))
  // TypeScript 7 without @typescript/typescript6 beside it.
  const native = await loadNativeTypeScript(root)
  if (!native)
    return skip(
      `TypeScript ${ts.version} has no compiler API that Intent can use; install @typescript/typescript6 beside it to suggest example repairs.`,
    )
  const virtualDir = slash(join(root, '.intent', 'skill-examples'))
  // The native API is unstable, so a failure reports the skipped suggestions
  // instead of stopping the repair command.
  try {
    return await withNativeCompiler(native, root, virtualDir, (open) =>
      splitExamples(lines, fences, nativeParser(native, virtualDir, open)),
    )
  } catch (error) {
    return skip(
      `TypeScript ${ts.version} could not parse the examples: ${errorMessage(error)}`,
    )
  }
}

async function splitExamples(
  lines: Array<string>,
  fences: ReturnType<typeof codeFences>,
  parser: ExampleParser,
) {
  const suggestions: Array<{ line: number; message: string }> = []
  for (const fence of fences) {
    const extension =
      fence.language === 'tsx' || fence.language === 'jsx'
        ? fence.language
        : fence.language.startsWith('j')
          ? 'js'
          : 'ts'
    const filename = `example.${extension}`
    const markers = (await parser.statements(filename, fence.code)).flatMap(
      (position) =>
        parser.comments(fence.code, position).flatMap((comment) => {
          const label = /^\/\/\s*(BEFORE|AFTER)\b[^\n]*$/i.exec(
            fence.code.slice(comment.pos, comment.end),
          )
          const lineStart = fence.code.lastIndexOf('\n', comment.pos - 1) + 1
          return label && !fence.code.slice(lineStart, comment.pos).trim()
            ? [{ label: label[1]!.toUpperCase(), pos: lineStart }]
            : []
        }),
    )
    if (
      markers.length !== 2 ||
      markers[0]!.label !== 'BEFORE' ||
      markers[1]!.label !== 'AFTER' ||
      fence.code.slice(0, markers[0]!.pos).trim()
    )
      continue
    const split = markers[1]!.pos
    const halves = [fence.code.slice(0, split), fence.code.slice(split)]
    let parses = true
    for (const code of halves)
      if (parses) parses = await parser.parses(filename, code)
    if (!parses) continue
    const at =
      fence.start + 1 + fence.code.slice(0, split).split('\n').length - 1
    const eol = lines[fence.start]!.endsWith('\r\n') ? '\r\n' : '\n'
    const closing = lines[fence.end]!.replace(/\r?\n$/, '')
    lines.splice(at, 0, `${closing}${eol}${eol}${lines[fence.start]}`)
    suggestions.unshift({
      line: at + 1,
      message:
        'Review splitting the labeled BEFORE/AFTER alternatives into separate code fences.',
    })
  }
  return { content: lines.join(''), suggestions }
}

function checkSkillLinks(
  root: string,
  file: string,
  content: string,
): Array<SkillBlockFinding> {
  const findings: Array<SkillBlockFinding> = []
  const absolute = resolve(root, file)
  // Blank out fenced examples, keeping newlines so line numbers still match.
  const lines = content.split(/\r?\n/)
  for (const fence of codeFences(content))
    for (
      let index = fence.start;
      index <= fence.end && index < lines.length;
      index++
    )
      lines[index] = ''
  const prose = lines.join('\n')
  for (const match of prose.matchAll(markdownLink)) {
    const target = match[1] ?? match[2]!
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) continue
    const path = target.replace(/[#?].*$/, '')
    if (!path) continue
    if (!existsSync(resolve(dirname(absolute), path)))
      findings.push({
        file,
        line: prose.slice(0, match.index).split('\n').length,
        message: `Link target not found: ${target}`,
        severity: 'error',
      })
  }
  return findings
}

// The file that declares the library's public types. A declared entry that
// Git tracks is hand-written and used as-is; a missing or ignored one is
// build output, so the matching source file stands in for it.
function libraryEntry(packageDir: string): string | null {
  let manifest: Record<string, unknown> = {}
  try {
    manifest = JSON.parse(
      readFileSync(join(packageDir, 'package.json'), 'utf8'),
    )
  } catch {
    // Fall through to the conventional source entry.
  }
  const exportsRoot = isRecord(manifest.exports)
    ? (manifest.exports['.'] ?? manifest.exports)
    : manifest.exports
  const declared = [
    manifest.types,
    manifest.typings,
    isRecord(exportsRoot) ? exportsRoot.types : undefined,
    isRecord(exportsRoot) && isRecord(exportsRoot.import)
      ? exportsRoot.import.types
      : undefined,
    isRecord(exportsRoot) && isRecord(exportsRoot.require)
      ? exportsRoot.require.types
      : undefined,
    typeof exportsRoot === 'string' ? exportsRoot : undefined,
    isRecord(exportsRoot) ? exportsRoot.import : undefined,
    isRecord(exportsRoot) ? exportsRoot.require : undefined,
    isRecord(exportsRoot) ? exportsRoot.default : undefined,
    manifest.module,
    manifest.main,
  ].find((value): value is string => typeof value === 'string')
  const candidates: Array<string> = []
  if (declared) {
    const path = resolve(packageDir, declared)
    if (existsSync(path) && isTracked(packageDir, path)) return path
    const name = declared
      .split('/')
      .at(-1)!
      .replace(/\.d\.(c|m)?ts$/, '')
      .replace(/\.(c|m)?[jt]sx?$/, '')
    candidates.push(
      `src/${name}.ts`,
      `src/${name}.tsx`,
      `src/${name}.d.ts`,
      `src/${name}.d.cts`,
      `src/${name}.d.mts`,
      `src/${name}.js`,
      `src/${name}.jsx`,
      `src/${name}.mjs`,
      `src/${name}.cjs`,
    )
  }
  candidates.push(
    'src/index.ts',
    'src/index.tsx',
    'index.ts',
    'index.d.ts',
    'src/index.js',
    'src/index.jsx',
    'src/index.mjs',
    'src/index.cjs',
    'index.js',
    'index.jsx',
    'index.mjs',
    'index.cjs',
  )
  for (const candidate of candidates) {
    const path = resolve(packageDir, candidate)
    if (existsSync(path)) return path
  }
  return null
}

// Every workspace package mapped to its own entry, so an example that imports
// a sibling package (an adapter, a framework binding) is checked against it
// instead of silently resolving to nothing.
function workspacePaths(root: string): Record<string, Array<string>> {
  const context = resolveProjectContext({ cwd: root })
  const workspaceRoot = context.workspaceRoot ?? root
  const paths: Record<string, Array<string>> = {}
  for (const dir of resolveWorkspacePackages(
    workspaceRoot,
    context.workspacePatterns,
  )) {
    let name: unknown
    try {
      name = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).name
    } catch {
      continue
    }
    const entry = typeof name === 'string' ? libraryEntry(dir) : null
    if (!entry) continue
    paths[name as string] = [slash(entry)]
    paths[`${name}/*`] = [
      slash(join(dirname(entry), '*')),
      slash(join(dir, '*')),
    ]
  }
  return paths
}

function isTracked(packageDir: string, path: string): boolean {
  try {
    execFileSync(
      'git',
      ['-c', 'core.fsmonitor=false', 'ls-files', '--error-unmatch', '--', path],
      { cwd: packageDir, stdio: 'ignore' },
    )
    return true
  } catch {
    return false
  }
}

function packageName(packageDir: string): string | undefined {
  try {
    const name: unknown = JSON.parse(
      readFileSync(join(packageDir, 'package.json'), 'utf8'),
    ).name
    return typeof name === 'string' ? name : undefined
  } catch {
    return undefined
  }
}

// TypeScript normalizes every path it hands back to forward slashes, so the
// virtual files and path mappings are keyed the same way on Windows.
const slash = (path: string) => path.replace(/\\/g, '/')

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export interface SkillBlockCache {
  workspacePaths?: Record<string, Array<string>>
  sourceFiles?: Map<string, TS.SourceFile>
}

export async function checkSkillBlocks(
  options: {
    root: string
    packageDir: string
    library: string
    skills: Array<{ file: string; content: string }>
    cache?: SkillBlockCache
  },
  ts?: typeof TS | null,
): Promise<SkillBlockCheck> {
  const { root, packageDir, library, cache = {} } = options
  const findings = options.skills.flatMap((skill) =>
    checkSkillLinks(root, skill.file, skill.content),
  )
  const blocks = options.skills.flatMap((skill) =>
    extractCodeBlocks(skill.file, skill.content),
  )
  const result = (skipped?: string): SkillBlockCheck => ({
    blocks: blocks.length,
    findings,
    skipped,
  })
  if (blocks.length === 0) return result()
  // Prose and link validation do not need the TypeScript runtime.
  if (ts === undefined) ts = loadTypeScript(root)
  if (!ts) return result('TypeScript is not installed in this repository')
  if (Number(ts.versionMajorMinor.split('.')[0]) < 5)
    return result(
      `TypeScript ${ts.version} is installed; 5.0 or newer is required`,
    )
  // TypeScript 7 without @typescript/typescript6 beside it.
  const native = hasCompilerApi(ts) ? null : await loadNativeTypeScript(root)
  if (!hasCompilerApi(ts) && !native)
    return result(
      `TypeScript ${ts.version} has no compiler API that Intent can use; install @typescript/typescript6 beside it`,
    )
  const entry = libraryEntry(packageDir)
  const ownsLibrary = packageName(packageDir) === library
  if (ownsLibrary && !entry)
    return result(
      `no type entry found for ${library} in ${relative(root, packageDir) || '.'}`,
    )

  const virtualDir = slash(join(root, '.intent', 'skill-examples'))
  const virtual = new Map<string, CodeBlock>()
  blocks.forEach((block, index) =>
    virtual.set(`${virtualDir}/block-${index}.${block.extension}`, block),
  )
  const compilerOptions = {
    ...exampleCompilerOptions,
    paths: {
      ...(cache.workspacePaths ??= workspacePaths(root)),
      // A skill documenting another package (metadata.library) resolves that
      // package through the workspace or node_modules, not this package's entry.
      ...(ownsLibrary
        ? {
            [library]: [slash(entry!)],
            [`${library}/*`]: [
              slash(join(dirname(entry!), '*')),
              slash(join(packageDir, '*')),
            ],
          }
        : {}),
    },
  }
  const fromLibrary = (specifier: string) =>
    specifier === library || specifier.startsWith(`${library}/`)

  if (native) {
    // The native API is unstable, so a failure reports the skipped checks
    // instead of stopping validation.
    try {
      findings.push(
        ...(await checkNativeBlocks(
          native,
          root,
          virtualDir,
          virtual,
          compilerOptions,
          fromLibrary,
        )),
      )
    } catch (error) {
      return result(
        `TypeScript ${ts.version} could not check the examples: ${errorMessage(error)}`,
      )
    }
    return result()
  }

  const parsedOptions = ts.convertCompilerOptionsFromJson(
    compilerOptions,
    root,
  ).options
  const host = ts.createCompilerHost(parsedOptions, true)
  const readFile = host.readFile.bind(host)
  const fileExists = host.fileExists.bind(host)
  host.fileExists = (path) => virtual.has(path) || fileExists(path)
  host.readFile = (path) => virtual.get(path)?.code ?? readFile(path)
  const sourceFiles = (cache.sourceFiles ??= new Map())
  host.getSourceFile = (path, languageVersion) => {
    const block = virtual.get(path)
    if (!block && sourceFiles.has(path)) return sourceFiles.get(path)
    const code = block?.code ?? readFile(path)
    if (code === undefined) return undefined
    const source = ts.createSourceFile(path, code, languageVersion, true)
    if (!block) sourceFiles.set(path, source)
    return source
  }
  const program = ts.createProgram([...virtual.keys()], parsedOptions, host)
  const checker = program.getTypeChecker()

  for (const [path, block] of virtual) {
    const source = program.getSourceFile(path)
    if (!source) continue
    const at = (position: number) =>
      block.line + source.getLineAndCharacterOfPosition(position).line
    for (const diagnostic of [
      ...program.getSyntacticDiagnostics(source),
      ...program.getSemanticDiagnostics(source),
    ]) {
      const finding = diagnosticFinding(
        block,
        diagnostic.start === undefined ? block.line : at(diagnostic.start),
        diagnostic.code,
        ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
        fromLibrary,
      )
      if (finding) findings.push(finding)
    }
    for (const statement of source.statements) {
      if (
        !ts.isImportDeclaration(statement) ||
        !ts.isStringLiteral(statement.moduleSpecifier) ||
        !fromLibrary(statement.moduleSpecifier.text)
      )
        continue
      const bindings = statement.importClause?.namedBindings
      if (!bindings || !ts.isNamedImports(bindings)) continue
      for (const element of bindings.elements) {
        let symbol = checker.getSymbolAtLocation(element.name)
        if (symbol && symbol.flags & ts.SymbolFlags.Alias)
          symbol = checker.getAliasedSymbol(symbol)
        const tag = symbol
          ?.getJsDocTags(checker)
          .find((entry) => entry.name === 'deprecated')
        if (tag)
          findings.push(
            deprecationFinding(
              block,
              at(element.getStart(source)),
              element.name.text,
              ts.displayPartsToString(tag.text),
            ),
          )
      }
    }
  }
  return result()
}

function checkNativeBlocks(
  native: NativeTypeScript,
  root: string,
  virtualDir: string,
  virtual: Map<string, CodeBlock>,
  compilerOptions: Record<string, unknown>,
  fromLibrary: (specifier: string) => boolean,
): Promise<Array<SkillBlockFinding>> {
  return withNativeCompiler(native, root, virtualDir, async (open) => {
    const findings: Array<SkillBlockFinding> = []
    const { program, checker } = await open(
      new Map([...virtual].map(([path, block]) => [path, block.code])),
      compilerOptions,
    )
    for (const [path, block] of virtual) {
      const source = await program.getSourceFile(path)
      if (!source) continue
      // The same line breaks as getLineAndCharacterOfPosition in TypeScript 6.
      const lineStarts = native.scanner.computeLineStarts(block.code)
      const at = (position: number) => {
        let line = 0
        while (
          lineStarts[line + 1] !== undefined &&
          lineStarts[line + 1]! <= position
        )
          line++
        return block.line + line
      }
      for (const diagnostic of [
        ...(await program.getSyntacticDiagnostics(path)),
        ...(await program.getSemanticDiagnostics(path)),
      ]) {
        const finding = diagnosticFinding(
          block,
          // A native diagnostic's pos is where the error starts, like start
          // in TypeScript 6; it does not include leading trivia.
          at(diagnostic.pos),
          diagnostic.code,
          nativeMessage(diagnostic),
          fromLibrary,
        )
        if (finding) findings.push(finding)
      }
      for (const statement of source.statements) {
        if (
          !native.is.isImportDeclaration(statement) ||
          !native.is.isStringLiteral(statement.moduleSpecifier) ||
          !fromLibrary(statement.moduleSpecifier.text)
        )
          continue
        const bindings = statement.importClause?.namedBindings
        if (!bindings || !native.is.isNamedImports(bindings)) continue
        for (const element of bindings.elements) {
          let symbol = await checker.getSymbolAtLocation(element.name)
          if (symbol && symbol.flags & native.api.SymbolFlags.Alias)
            symbol = await checker.getAliasedSymbol(symbol)
          const tag = symbol
            ? (await symbol.getJsDocTags(checker)).find(
                (entry) => entry.name === 'deprecated',
              )
            : undefined
          if (tag)
            findings.push(
              deprecationFinding(
                block,
                // Skips leading trivia, like getStart in TypeScript 6.
                at(native.ast.getTokenPosOfNode(element, source)),
                element.name.text,
                tag.text ?? '',
              ),
            )
        }
      }
    }
    return findings
  })
}

// Partial examples leave out names, globals, and external modules on purpose;
// only a missing module from the documented library is reported.
function diagnosticFinding(
  block: CodeBlock,
  line: number,
  code: number,
  message: string,
  fromLibrary: (specifier: string) => boolean,
): SkillBlockFinding | null {
  if (partialSnippetCodes.has(code)) return null
  if (missingModuleCodes.has(code)) {
    const specifier = /Cannot find module '([^']+)'/.exec(message)?.[1]
    if (!specifier || !fromLibrary(specifier)) return null
  }
  return {
    file: block.file,
    line,
    message: `TS${code}: ${message}`,
    severity: 'error',
  }
}

function deprecationFinding(
  block: CodeBlock,
  line: number,
  name: string,
  detail: string,
): SkillBlockFinding {
  detail = detail.trim()
  return {
    file: block.file,
    line,
    message: `${name} is deprecated${detail ? `: ${detail}` : ''}`,
    severity: 'warning',
  }
}

// One-line summary per skill for review items, in one program per package.
// Skills without code blocks, or whose blocks could not be checked, are left
// out of the result.
export async function describeSkillExamples(
  root: string,
  files: Array<string>,
): Promise<Map<string, string>> {
  const groups = new Map<
    string,
    { packageDir: string; library: string; files: Array<string> }
  >()
  for (const file of files) {
    const absolute = resolve(root, file)
    const { packageRoot } = resolveProjectContext({
      cwd: root,
      targetPath: absolute,
    })
    if (!packageRoot) continue
    let library: unknown = readScalarField(
      parseFrontmatter(absolute),
      'library',
    )
    if (!library) {
      try {
        library = JSON.parse(
          readFileSync(join(packageRoot, 'package.json'), 'utf8'),
        ).name
      } catch {
        continue
      }
    }
    if (typeof library !== 'string') continue
    const key = `${packageRoot}\0${library}`
    const group = groups.get(key) ?? {
      packageDir: packageRoot,
      library,
      files: [],
    }
    group.files.push(file)
    groups.set(key, group)
  }
  const summaries = new Map<string, string>()
  const cache: SkillBlockCache = {}
  for (const group of groups.values()) {
    const skills = group.files.map((file) => ({
      file,
      content: readFileSync(resolve(root, file), 'utf8'),
    }))
    const result = await checkSkillBlocks({
      root,
      packageDir: group.packageDir,
      library: group.library,
      skills,
      cache,
    })
    for (const [file, summary] of summarizeSkillExamples(result, skills))
      summaries.set(file, summary)
  }
  return summaries
}

// Share the result of validation with the maintainer report, without retaining
// compiler state across invocations or skipping any validation roots.
export function summarizeSkillExamples(
  result: SkillBlockCheck,
  skills: ReadonlyArray<{ file: string; content: string }>,
): Map<string, string> {
  const summaries = new Map<string, string>()
  if (result.skipped) return summaries
  for (const skill of skills) {
    if (!extractCodeBlocks(skill.file, skill.content).length) continue
    const errors = result.findings.filter(
      (finding) => finding.file === skill.file && finding.severity === 'error',
    )
    summaries.set(
      skill.file,
      errors.length
        ? `${errors.length} example error(s), first at line ${errors[0]!.line}`
        : 'examples still compile',
    )
  }
  return summaries
}
