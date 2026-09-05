import { PassThrough } from 'node:stream'
import { stripVTControlCharacters } from 'node:util'
import * as clack from '@clack/prompts'
import { describe, expect, it, vi } from 'vitest'
import { createPermissionPrompts } from '../src/commands/install/permission-prompts.js'
import type { ClackPermissionRuntime } from '../src/commands/install/permission-prompts.js'
import type { PermissionPackage } from '../src/commands/install/permissions.js'

const pkg: PermissionPackage = {
  id: 'pkg',
  version: '1.0.0',
  skills: [
    {
      id: 'pkg#core',
      name: 'core',
      description: 'Core guidance. '.repeat(50),
      excluded: false,
    },
    {
      id: 'pkg#other',
      name: 'other',
      description: 'Other guidance',
      excluded: false,
    },
    {
      id: 'pkg#private',
      name: 'private',
      description: 'Private guidance',
      excluded: true,
    },
  ],
}

function runtime() {
  return {
    ...clack,
    autocomplete: vi.fn().mockResolvedValue('continue'),
    autocompleteMultiselect: vi.fn().mockResolvedValue([]),
    select: vi.fn().mockResolvedValue('back'),
    confirm: vi.fn().mockResolvedValue(false),
    cancel: vi.fn(),
    isCancel: (value: unknown): value is symbol => typeof value === 'symbol',
  }
}

function prompts(api: ReturnType<typeof runtime>) {
  return createPermissionPrompts(api)
}

describe('package permission picker', () => {
  it('starts with no permissions selected and excludes unavailable packages', async () => {
    const api = runtime()
    const blocked = {
      ...pkg,
      id: 'blocked',
      skills: pkg.skills.filter((skill) => skill.excluded),
    }
    await expect(
      prompts(api).selectPermissions([pkg, blocked], '/package.json'),
    ).resolves.toEqual([])
    const options = api.autocompleteMultiselect.mock.calls[0]?.[0]
    expect(options).toMatchObject({
      initialValues: [],
      required: false,
      maxItems: 6,
    })
    expect(
      options.options.map((option: { value: string }) => option.value),
    ).toEqual(['pkg'])
    expect(api.confirm).not.toHaveBeenCalled()
  })

  it('narrows package-wide permissions to exact skills and never offers excluded skills', async () => {
    const api = runtime()
    api.autocompleteMultiselect
      .mockResolvedValueOnce(['pkg'])
      .mockResolvedValueOnce(['pkg#core'])
    api.autocomplete
      .mockResolvedValueOnce(pkg)
      .mockResolvedValueOnce('continue')
    api.select.mockResolvedValueOnce('skills')
    await expect(
      prompts(api).selectPermissions([pkg], '/package.json'),
    ).resolves.toEqual(['pkg#core'])
    const options = api.autocompleteMultiselect.mock.calls[1]?.[0]
    expect(options.initialValues).toEqual(['pkg#core', 'pkg#other'])
    expect(
      options.options.map((option: { value: string }) => option.value),
    ).toEqual(['pkg#core', 'pkg#other'])
    expect(options.options[0].hint.length).toBeLessThanOrEqual(120)
    expect(api.autocomplete.mock.calls[2]?.[0]).toBeUndefined()
    expect(api.autocomplete.mock.calls[1]?.[0].options[1].label).toContain(
      '1 individual skill selected',
    )
  })

  it('preserves exact choices when revisiting the package picker', async () => {
    const api = runtime()
    api.autocomplete
      .mockResolvedValueOnce(pkg)
      .mockResolvedValueOnce('packages')
      .mockResolvedValueOnce('continue')
    api.select.mockResolvedValueOnce('skills')
    api.autocompleteMultiselect
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(['pkg#core'])
      .mockResolvedValueOnce([])
    await expect(
      prompts(api).selectPermissions([pkg], '/package.json'),
    ).resolves.toEqual(['pkg#core'])
  })

  it.each(['all', 'none'])(
    'can change exact choices to %s from package review',
    async (action) => {
      const api = runtime()
      api.autocompleteMultiselect
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce(['pkg#core'])
      api.autocomplete
        .mockResolvedValueOnce(pkg)
        .mockResolvedValueOnce(pkg)
        .mockResolvedValueOnce('continue')
      api.select.mockResolvedValueOnce('skills').mockResolvedValueOnce(action)
      await expect(
        prompts(api).selectPermissions([pkg], '/package.json'),
      ).resolves.toEqual(action === 'all' ? ['pkg'] : [])
    },
  )

  it('shows full descriptions only on request without changing permissions', async () => {
    const api = runtime()
    const output = vi.spyOn(console, 'log').mockImplementation(() => {})
    api.autocomplete
      .mockResolvedValueOnce(pkg)
      .mockResolvedValueOnce(pkg.skills[2])
      .mockResolvedValueOnce('back')
      .mockResolvedValueOnce('continue')
    api.select.mockResolvedValueOnce('details').mockResolvedValueOnce('back')
    try {
      await expect(
        prompts(api).selectPermissions([pkg], '/package.json'),
      ).resolves.toEqual([])
      expect(output.mock.calls.flat().join('\n')).toContain(
        'pkg#private — excluded by intent.exclude\nPrivate guidance',
      )
      expect(output.mock.calls.flat().join('\n')).not.toContain('Core guidance')
      expect(api.autocomplete.mock.calls[1]?.[0].options[3].label).toBe(
        'private (excluded)',
      )
    } finally {
      output.mockRestore()
    }
  })

  it('shows exact configuration and destination only on request', async () => {
    const api = runtime()
    api.autocompleteMultiselect.mockResolvedValueOnce(['pkg'])
    api.autocomplete
      .mockResolvedValueOnce('config')
      .mockResolvedValueOnce('continue')
    const output = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      await expect(
        prompts(api).selectPermissions([pkg], '/app/package.json'),
      ).resolves.toEqual(['pkg'])
      expect(output.mock.calls.flat().join('\n')).toBe(
        'Permission destination: /app/package.json\nintent.skills: [\n  "pkg"\n]',
      )
    } finally {
      output.mockRestore()
    }
  })

  it.each([false, true])(
    'requires an explicit advanced allow-all decision: %s',
    async (confirmed) => {
      const api = runtime()
      api.autocompleteMultiselect.mockResolvedValueOnce(['pkg'])
      api.autocomplete
        .mockResolvedValueOnce('all')
        .mockResolvedValueOnce('continue')
      api.confirm.mockResolvedValueOnce(confirmed)
      await expect(
        prompts(api).selectPermissions([pkg], '/package.json'),
      ).resolves.toEqual(confirmed ? ['*'] : ['pkg'])
      expect(api.confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          initialValue: false,
          message:
            'Allow all current and future npm and workspace skill sources?',
        }),
      )
    },
  )

  it.each(['packages', 'review', 'package', 'skills', 'details', 'advanced'])(
    'cancels once from %s',
    async (stage) => {
      const api = runtime()
      const canceled = Symbol('cancel')
      if (stage === 'packages')
        api.autocompleteMultiselect.mockResolvedValueOnce(canceled)
      if (stage === 'review') api.autocomplete.mockResolvedValueOnce(canceled)
      if (stage === 'package') {
        api.autocomplete.mockResolvedValueOnce(pkg)
        api.select.mockResolvedValueOnce(canceled)
      }
      if (stage === 'skills') {
        api.autocomplete.mockResolvedValueOnce(pkg)
        api.select.mockResolvedValueOnce('skills')
        api.autocompleteMultiselect
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce(canceled)
      }
      if (stage === 'details') {
        api.autocomplete
          .mockResolvedValueOnce(pkg)
          .mockResolvedValueOnce(canceled)
        api.select.mockResolvedValueOnce('details')
      }
      if (stage === 'advanced') {
        api.autocomplete.mockResolvedValueOnce('all')
        api.confirm.mockResolvedValueOnce(canceled)
      }
      await expect(
        prompts(api).selectPermissions([pkg], '/package.json'),
      ).resolves.toBeNull()
      expect(api.cancel).toHaveBeenCalledOnce()
    },
  )

  it('defaults final confirmation to No, including explicit deny-all', async () => {
    const api = runtime()
    await expect(prompts(api).confirmWrite(false)).resolves.toBe(false)
    await expect(prompts(api).confirmWrite(true)).resolves.toBe(false)
    expect(api.confirm.mock.calls[0]?.[0]).toMatchObject({
      initialValue: false,
      message: 'Write this permission configuration?',
    })
    expect(api.confirm.mock.calls[1]?.[0]).toMatchObject({
      initialValue: false,
      message: 'Disable all skills by writing intent.skills: []?',
    })
    api.confirm.mockResolvedValueOnce(Symbol('cancel'))
    await expect(prompts(api).confirmWrite(false)).resolves.toBeNull()
    expect(api.cancel).toHaveBeenCalledOnce()
  })

  it('searches package choices and review through real Clack with a large catalog', async () => {
    vi.stubEnv('TERM', 'xterm-256color')
    const input = new PassThrough()
    const output = Object.assign(new PassThrough(), { columns: 80, rows: 24 })
    let rendered = ''
    output.on('data', (data) => {
      rendered += data.toString()
    })
    const packages = Array.from({ length: 14 }, (_, index) => ({
      ...pkg,
      id: `package-${index}`,
    }))
    let firstFrame = ''
    const api: ClackPermissionRuntime = {
      ...clack,
      autocompleteMultiselect: (options) => {
        const result = clack.autocompleteMultiselect({
          ...options,
          input,
          output,
        })
        process.nextTick(() => {
          firstFrame = stripVTControlCharacters(rendered)
          input.write('package-13\t\r')
        })
        return result
      },
      autocomplete: (options) => {
        const result = clack.autocomplete({ ...options, input, output })
        process.nextTick(() => {
          input.write('no-such-package\r')
          expect(stripVTControlCharacters(rendered)).toContain(
            'Choose a listed option or change your search.',
          )
          process.nextTick(() => {
            input.write('\x15')
            process.nextTick(() => input.write('Continue\r'))
          })
        })
        return result
      },
    }
    try {
      await expect(
        createPermissionPrompts(api).selectPermissions(
          packages,
          '/package.json',
        ),
      ).resolves.toEqual(['package-13'])
      expect(firstFrame.match(/[◻◼]/g)?.length).toBeLessThanOrEqual(6)
      expect(firstFrame).not.toContain('package-13')
      expect(firstFrame).not.toContain('Core guidance')
      expect(firstFrame.split('\n').length).toBeLessThan(20)
      expect(stripVTControlCharacters(rendered)).toContain(
        'package-13 — all current and future skills',
      )
    } finally {
      vi.unstubAllEnvs()
      input.destroy()
      output.destroy()
    }
  })
})
