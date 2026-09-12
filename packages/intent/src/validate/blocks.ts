import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { resolveProjectContext } from '../core/project-context.js'
import { resolveWorkspacePackages } from '../setup/workspace-patterns.js'
import { parseFrontmatter, readScalarField } from '../shared/utils.js'
import type TS from 'typescript'

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
}

const codeFence =
  /^ {0,3}(`{3,}|~{3,})[ \t]*([A-Za-z0-9_-]*)[^\n]*\n([\s\S]*?)\n {0,3}\1[ \t]*$/gm
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
  2602, 2686, 2688, 7006, 7026, 7031, 17004,
])
const missingModuleCodes = new Set([2307, 2792])

function loadTypeScript(root: string): typeof TS | null {
  for (const from of [join(root, 'package.json'), import.meta.url]) {
    try {
      return createRequire(from)('typescript') as typeof TS
    } catch {
      // Try the next location.
    }
  }
  return null
}

function extractCodeBlocks(file: string, content: string): Array<CodeBlock> {
  const blocks: Array<CodeBlock> = []
  for (const match of content.matchAll(codeFence)) {
    const language = match[2]!.toLowerCase()
    if (!checkedLanguages.has(language)) continue
    const line = content.slice(0, match.index).split('\n').length + 1
    blocks.push({ file, line, code: match[3]! })
  }
  return blocks
}

function checkSkillLinks(
  root: string,
  file: string,
  content: string,
): Array<SkillBlockFinding> {
  const findings: Array<SkillBlockFinding> = []
  const absolute = resolve(root, file)
  // Blank out fenced examples, keeping newlines so line numbers still match.
  const prose = content.replace(codeFence, (block) =>
    block.replace(/[^\n]/g, ' '),
  )
  for (const match of prose.matchAll(markdownLink)) {
    const target = match[1] ?? match[2]!
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) continue
    const path = target.replace(/[#?].*$/, '')
    if (!path) continue
    if (!existsSync(resolve(dirname(absolute), path)))
      findings.push({
        file,
        line: content.slice(0, match.index).split('\n').length,
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
    typeof exportsRoot === 'string' ? exportsRoot : undefined,
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
    )
  }
  candidates.push('src/index.ts', 'src/index.tsx', 'index.ts', 'index.d.ts')
  for (const candidate of candidates) {
    const path = resolve(packageDir, candidate)
    if (existsSync(path)) return path
  }
  return null
}

// Every workspace package mapped to its own entry, so an example that imports
// a sibling package (an adapter, a framework binding) is checked against it
// instead of silently resolving to nothing.
const workspaceEntries = new Map<string, Record<string, Array<string>>>()
function workspacePaths(root: string): Record<string, Array<string>> {
  const context = resolveProjectContext({ cwd: root })
  const workspaceRoot = context.workspaceRoot ?? root
  const cached = workspaceEntries.get(workspaceRoot)
  if (cached) return cached
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
  workspaceEntries.set(workspaceRoot, paths)
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

export function checkSkillBlocks(
  options: {
    root: string
    packageDir: string
    library: string
    skills: Array<{ file: string; content: string }>
  },
  ts: typeof TS | null = loadTypeScript(options.root),
): SkillBlockCheck {
  const { root, packageDir, library } = options
  // `check` validates every skill and then describes the pending ones, so a
  // skill's result is kept for the rest of the process instead of building a
  // second program for the same content.
  const findings: Array<SkillBlockFinding> = []
  const skills: Array<{ file: string; content: string; key: string }> = []
  let blockCount = 0
  const entry = ts ? libraryEntry(packageDir) : null
  const stamp = entry ? `${entry}\0${statSync(entry).mtimeMs}` : ''
  for (const skill of options.skills) {
    const key = [
      packageDir,
      library,
      stamp,
      skill.file,
      digest(skill.content),
    ].join('\0')
    const cached = checked.get(key)
    if (cached) {
      findings.push(...cached.findings)
      blockCount += cached.blocks
    } else skills.push({ ...skill, key })
  }
  for (const skill of skills)
    findings.push(...checkSkillLinks(root, skill.file, skill.content))
  const blocks = skills.flatMap((skill) =>
    extractCodeBlocks(skill.file, skill.content),
  )
  const remember = (skipped?: string) => {
    if (!skipped)
      for (const skill of skills)
        checked.set(skill.key, {
          blocks: blocks.filter((block) => block.file === skill.file).length,
          findings: findings.filter((finding) => finding.file === skill.file),
        })
    return { blocks: blockCount + blocks.length, findings, skipped }
  }
  if (blocks.length === 0) return remember()
  if (!ts) return remember('TypeScript is not installed in this repository')
  if (Number(ts.versionMajorMinor.split('.')[0]) < 5)
    return remember(
      `TypeScript ${ts.version} is installed; 5.0 or newer is required`,
    )
  const ownsLibrary = packageName(packageDir) === library
  if (ownsLibrary && !entry)
    return remember(
      `no type entry found for ${library} in ${relative(root, packageDir) || '.'}`,
    )

  const virtualDir = slash(join(root, '.intent', 'skill-examples'))
  const virtual = new Map<string, CodeBlock>()
  blocks.forEach((block, index) =>
    virtual.set(`${virtualDir}/block-${index}.tsx`, block),
  )
  const compilerOptions: TS.CompilerOptions = {
    noEmit: true,
    strict: false,
    skipLibCheck: true,
    allowJs: true,
    checkJs: false,
    resolveJsonModule: true,
    esModuleInterop: true,
    allowSyntheticDefaultImports: true,
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.Preserve,
    lib: ['lib.esnext.d.ts', 'lib.dom.d.ts'],
    paths: {
      ...workspacePaths(root),
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
    types: [],
  }
  const host = ts.createCompilerHost(compilerOptions, true)
  const readFile = host.readFile.bind(host)
  const fileExists = host.fileExists.bind(host)
  host.fileExists = (path) => virtual.has(path) || fileExists(path)
  host.readFile = (path) => virtual.get(path)?.code ?? readFile(path)
  host.getSourceFile = (path, languageVersion) => {
    const code = virtual.get(path)?.code ?? readFile(path)
    return code === undefined
      ? undefined
      : ts.createSourceFile(path, code, languageVersion, true)
  }
  const program = ts.createProgram([...virtual.keys()], compilerOptions, host)
  const checker = program.getTypeChecker()
  const fromLibrary = (specifier: string) =>
    specifier === library || specifier.startsWith(`${library}/`)

  for (const [path, block] of virtual) {
    const source = program.getSourceFile(path)
    if (!source) continue
    const at = (position: number) =>
      block.line + source.getLineAndCharacterOfPosition(position).line
    for (const diagnostic of [
      ...program.getSyntacticDiagnostics(source),
      ...program.getSemanticDiagnostics(source),
    ]) {
      if (partialSnippetCodes.has(diagnostic.code)) continue
      const message = ts.flattenDiagnosticMessageText(
        diagnostic.messageText,
        ' ',
      )
      if (missingModuleCodes.has(diagnostic.code)) {
        const specifier = /Cannot find module '([^']+)'/.exec(message)?.[1]
        if (!specifier || !fromLibrary(specifier)) continue
      }
      findings.push({
        file: block.file,
        line:
          diagnostic.start === undefined ? block.line : at(diagnostic.start),
        message: `TS${diagnostic.code}: ${message}`,
        severity: 'error',
      })
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
        if (!tag) continue
        const detail = ts.displayPartsToString(tag.text).trim()
        findings.push({
          file: block.file,
          line: at(element.getStart(source)),
          message: `${element.name.text} is deprecated${detail ? `: ${detail}` : ''}`,
          severity: 'warning',
        })
      }
    }
  }
  return remember()
}

const checked = new Map<
  string,
  { blocks: number; findings: Array<SkillBlockFinding> }
>()
const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex')

// One-line summary per skill for review items, in one program per package.
// Skills without code blocks, or whose blocks could not be checked, are left
// out of the result.
export function describeSkillExamples(
  root: string,
  files: Array<string>,
): Map<string, string> {
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
  for (const group of groups.values()) {
    const skills = group.files.map((file) => ({
      file,
      content: readFileSync(resolve(root, file), 'utf8'),
    }))
    const result = checkSkillBlocks({
      root,
      packageDir: group.packageDir,
      library: group.library,
      skills,
    })
    if (result.skipped) continue
    for (const skill of skills) {
      if (!extractCodeBlocks(skill.file, skill.content).length) continue
      const errors = result.findings.filter(
        (finding) =>
          finding.file === skill.file && finding.severity === 'error',
      )
      summaries.set(
        skill.file,
        errors.length
          ? `${errors.length} example error(s), first at line ${errors[0]!.line}`
          : 'examples still compile',
      )
    }
  }
  return summaries
}
