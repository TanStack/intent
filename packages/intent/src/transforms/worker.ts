// Self-contained bootstrap for the restricted transform subprocess.
// Only this trusted bootstrap runs outside the VM. No host paths are granted.
import { Script, SourceTextModule, createContext } from 'node:vm'
import { VirtualFileSystem } from '@platformatic/vfs'
import type { MemoryProvider } from '@platformatic/vfs'

// Some platforms add process variables even when spawn receives env: {}.
for (const key of Object.keys(process.env)) delete process.env[key]

// The parent prepends the serialized request to this script on stdin.
const globals = globalThis as typeof globalThis & {
  __intentTransformInput?: string
}
const request = JSON.parse(globals.__intentTransformInput!)
delete globals.__intentTransformInput
const skill = new VirtualFileSystem(undefined, {
  moduleHooks: false,
  overlay: false,
})
const config = new VirtualFileSystem(undefined, {
  moduleHooks: false,
  overlay: false,
})
const configNames = new Set(Object.keys(request.config))
function path(name: string) {
  if (
    typeof name !== 'string' ||
    !name ||
    name.includes('\\') ||
    name.includes('\0') ||
    name.includes(':') ||
    name.split('/').some((p) => !p || p === '.' || p === '..')
  )
    throw new Error('Expected a root-relative file path: ' + name)
  return '/' + name
}
function write(fs: VirtualFileSystem, name: string, text: string) {
  if (typeof text !== 'string') throw new Error('File content must be a string')
  const target = path(name)
  const parent = target.slice(0, target.lastIndexOf('/'))
  if (parent) fs.mkdirSync(parent, { recursive: true })
  fs.writeFileSync(target, text, 'utf8')
}
for (const [name, text] of Object.entries(
  request.skill as Record<string, string>,
))
  write(skill, name, text)
for (const [name, text] of Object.entries(
  request.config as Record<string, string>,
))
  write(config, name, text)
;(skill.provider as MemoryProvider).setReadOnly()
function reader(fs: VirtualFileSystem, names: Iterable<string>) {
  return {
    readFile: (name: string) => fs.readFileSync(path(name), 'utf8'),
    exists: (name: string) => fs.existsSync(path(name)),
    listFiles: () => [...names].sort(),
  }
}
const configApi = Object.freeze({
  ...reader(config, configNames),
  writeFile(name: string, text: string) {
    write(config, name, text)
    configNames.add(name)
  },
  removeFile(name: string) {
    if (config.existsSync(path(name))) config.unlinkSync(path(name))
    configNames.delete(name)
  },
})
const context = createContext(
  Object.assign(Object.create(null), {
    fetch: undefined,
    WebSocket: undefined,
    XMLHttpRequest: undefined,
    process: undefined,
    require: undefined,
    skill: Object.freeze(reader(skill, Object.keys(request.skill))),
    config: configApi,
    inputJson: JSON.stringify({
      answers: request.answers,
      args: request.args,
      stdin: request.stdin,
      commands: request.commands,
    }),
  }),
  {
    codeGeneration: { strings: false, wasm: false },
    microtaskMode: 'afterEvaluate',
  },
)
// No default loader: transforms are self-contained ES modules, with no imports.
const module = new SourceTextModule(request.code, {
  context,
  identifier: 'intent-transform',
})
await module.link(() => {
  throw new Error(
    'Transform imports are disabled; bundle your transform into one file',
  )
})
const evaluation = module.evaluate({ timeout: 1000 })
// Older Node releases queue evaluation's completion in the VM context when
// microtaskMode is afterEvaluate. Drain it before awaiting from the host.
new Script('').runInContext(context, { timeout: 1000 })
await evaluation
context.transform = module.namespace
context.operation = request.operation
const result = new Script(
  'transform[operation]({ skill, config, ...JSON.parse(inputJson) })',
).runInContext(context, { timeout: 1000 })
if (typeof result !== 'string')
  throw new Error('Transform must return a string synchronously')
const files = Object.fromEntries(
  [...configNames]
    .sort()
    .map((name) => [name, config.readFileSync(path(name), 'utf8')]),
)
process.stdout.write(JSON.stringify({ content: result, files }))
