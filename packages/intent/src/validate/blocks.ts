import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, resolve } from 'node:path'
import { resolveProjectContext } from '../core/project-context.js'
import { parseFrontmatter, readScalarField } from '../shared/utils.js'
import type TS from 'typescript'

export interface SkillBlockFinding {
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
const markdownLink = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g

// Diagnostics that a deliberately partial example produces: names, modules,
// and globals the snippet leaves out. Everything else describes the library
// contract or a genuinely broken example.
const partialSnippetCodes = new Set([
  1375, 2304, 2318, 2503, 2552, 2580, 2581, 2582, 2583, 2584, 2591, 2592, 2593,
  2602, 2686, 2688, 7006, 7026, 7031, 17004,
])
const missingModuleCodes = new Set([2307, 2792])

export function loadTypeScript(root: string): typeof TS | null {
  for (const from of [join(root, 'package.json'), import.meta.url]) {
    try {
      return createRequire(from)('typescript') as typeof TS
    } catch {
      // Try the next location.
    }
  }
  return null
}

export function extractCodeBlocks(
  file: string,
  content: string,
): Array<CodeBlock> {
  const blocks: Array<CodeBlock> = []
  for (const match of content.matchAll(codeFence)) {
    const language = match[2]!.toLowerCase()
    if (!checkedLanguages.has(language)) continue
    const line = content.slice(0, match.index).split('\n').length + 1
    blocks.push({ file, line, code: match[3]! })
  }
  return blocks
}

export function checkSkillLinks(
  root: string,
  file: string,
  content: string,
): Array<SkillBlockFinding> {
  const findings: Array<SkillBlockFinding> = []
  const absolute = resolve(root, file)
  for (const match of content.matchAll(markdownLink)) {
    const target = match[1]!
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

// The file that declares the library's public types: the conventional source
// entry, then package metadata.
export function libraryEntry(packageDir: string): string | null {
  let manifest: Record<string, unknown>
  try {
    manifest = JSON.parse(
      readFileSync(join(packageDir, 'package.json'), 'utf8'),
    )
  } catch {
    return null
  }
  const exportsRoot = isRecord(manifest.exports)
    ? (manifest.exports['.'] ?? manifest.exports)
    : manifest.exports
  // Source first: a maintainer's build output can be stale or absent.
  const candidates = [
    'src/index.ts',
    'src/index.tsx',
    manifest.types,
    manifest.typings,
    typeof exportsRoot === 'string' ? exportsRoot : undefined,
    isRecord(exportsRoot) ? exportsRoot.types : undefined,
    isRecord(exportsRoot) && isRecord(exportsRoot.import)
      ? exportsRoot.import.types
      : undefined,
    'index.ts',
    'index.d.ts',
  ]
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    const path = resolve(packageDir, candidate)
    if (existsSync(path)) return path
  }
  return null
}

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
  const { root, packageDir, library, skills } = options
  const findings: Array<SkillBlockFinding> = []
  for (const skill of skills)
    findings.push(...checkSkillLinks(root, skill.file, skill.content))
  const blocks = skills.flatMap((skill) =>
    extractCodeBlocks(skill.file, skill.content),
  )
  if (blocks.length === 0) return { blocks: 0, findings }
  if (!ts)
    return {
      blocks: blocks.length,
      findings,
      skipped: 'TypeScript is not installed in this repository',
    }
  const entry = libraryEntry(packageDir)
  if (!entry)
    return {
      blocks: blocks.length,
      findings,
      skipped: `no type entry found for ${library} in ${relative(root, packageDir) || '.'}`,
    }

  const virtualDir = join(root, '.intent', 'skill-examples')
  const virtual = new Map<string, CodeBlock>()
  blocks.forEach((block, index) =>
    virtual.set(join(virtualDir, `block-${index}.tsx`), block),
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
    baseUrl: root,
    paths: { [library]: [entry], [`${library}/*`]: [join(packageDir, '*')] },
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
    for (const diagnostic of program.getSemanticDiagnostics(source)) {
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
  return { blocks: blocks.length, findings }
}

// One-line summary of a skill's examples for a review item, or null when the
// skill has no code blocks or they could not be checked.
export function describeSkillExamples(
  root: string,
  file: string,
): string | null {
  const absolute = resolve(root, file)
  const { packageRoot } = resolveProjectContext({
    cwd: root,
    targetPath: absolute,
  })
  if (!packageRoot) return null
  let library = readScalarField(parseFrontmatter(absolute), 'library')
  if (!library) {
    try {
      library = JSON.parse(
        readFileSync(join(packageRoot, 'package.json'), 'utf8'),
      ).name
    } catch {
      return null
    }
  }
  if (typeof library !== 'string') return null
  const result = checkSkillBlocks({
    root,
    packageDir: packageRoot,
    library,
    skills: [{ file, content: readFileSync(absolute, 'utf8') }],
  })
  if (result.blocks === 0 || result.skipped) return null
  const errors = result.findings.filter(
    (finding) => finding.severity === 'error',
  )
  return errors.length
    ? `${errors.length} example error(s), first at line ${errors[0]!.line}`
    : 'examples still compile'
}
