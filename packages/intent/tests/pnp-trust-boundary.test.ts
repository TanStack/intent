import { sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isPnpRuntimeWithinNodeModules } from '../src/discovery/scanner.js'

const abs = (...segments: Array<string>): string => sep + segments.join(sep)

describe('isPnpRuntimeWithinNodeModules', () => {
  it('trusts a project-root .pnp.cjs', () => {
    expect(isPnpRuntimeWithinNodeModules(abs('app', '.pnp.cjs'))).toBe(false)
  })

  it('trusts an ancestor .pnp.cjs above the project', () => {
    expect(isPnpRuntimeWithinNodeModules(abs('.pnp.cjs'))).toBe(false)
    expect(
      isPnpRuntimeWithinNodeModules(abs('workspace', 'app', '..', '.pnp.cjs')),
    ).toBe(false)
  })

  it('rejects a .pnp.cjs resolved from within node_modules', () => {
    expect(
      isPnpRuntimeWithinNodeModules(
        abs('app', 'node_modules', 'evil-pkg', '.pnp.cjs'),
      ),
    ).toBe(true)
  })

  it('rejects a nested-node_modules .pnp.cjs', () => {
    expect(
      isPnpRuntimeWithinNodeModules(
        abs('app', 'node_modules', 'a', 'node_modules', 'b', '.pnp.cjs'),
      ),
    ).toBe(true)
  })

  it('does not match a directory whose name merely contains node_modules', () => {
    expect(
      isPnpRuntimeWithinNodeModules(abs('app', 'my-node_modules', '.pnp.cjs')),
    ).toBe(false)
  })
})
