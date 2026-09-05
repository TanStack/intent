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
const workspace: PermissionPackage = {
  id: 'workspace:pkg',
  version: '1.0.0',
  skills: [
    {
      id: 'workspace:pkg#local',
      name: 'local',
      description: 'Workspace guidance',
      excluded: false,
    },
  ],
}
function runtime() {
  return {
    ...clack,
    select: vi.fn().mockResolvedValue('all'),
    autocomplete: vi.fn().mockResolvedValue('back'),
    autocompleteMultiselect: vi.fn().mockResolvedValue([]),
    cancel: vi.fn(),
    isCancel: (value: unknown): value is symbol => typeof value === 'symbol',
  }
}

describe('skill enablement', () => {
  it('enables all sources with a compact wildcard without another selection screen', async () => {
    const api = runtime()
    await expect(
      createPermissionPrompts(api).selectPermissions([pkg, workspace]),
    ).resolves.toEqual(['*'])
    expect(api.select).toHaveBeenCalledOnce()
    expect(api.autocompleteMultiselect).not.toHaveBeenCalled()
    expect(api.autocomplete).not.toHaveBeenCalled()
  })

  it('keeps selected packages compact without a permission review screen', async () => {
    const api = runtime()
    api.select.mockResolvedValueOnce('packages')
    api.autocompleteMultiselect.mockResolvedValueOnce(['pkg'])
    const blocked = {
      id: 'blocked',
      version: '1.0.0',
      skills: [{ ...pkg.skills[2]!, id: 'blocked#private' }],
    }
    await expect(
      createPermissionPrompts(api).selectPermissions([pkg, workspace, blocked]),
    ).resolves.toEqual(['pkg'])
    expect(api.select).toHaveBeenCalledOnce()
    expect(api.autocompleteMultiselect).toHaveBeenCalledOnce()
    expect(api.autocompleteMultiselect.mock.calls[0]?.[0]).toMatchObject({
      initialValues: [],
      required: false,
      maxItems: 6,
    })
    expect(
      api.autocompleteMultiselect.mock.calls[0]?.[0].options.map(
        (option: { value: string }) => option.value,
      ),
    ).toEqual(['pkg', 'workspace:pkg'])
    expect(api.autocomplete).not.toHaveBeenCalled()
  })

  it('allows individual selections across packages with bounded descriptions', async () => {
    const api = runtime()
    api.select.mockResolvedValueOnce('skills')
    api.autocompleteMultiselect.mockResolvedValueOnce([
      'pkg#core',
      'workspace:pkg#local',
    ])
    await expect(
      createPermissionPrompts(api).selectPermissions([pkg, workspace]),
    ).resolves.toEqual(['pkg#core', 'workspace:pkg#local'])
    const options = api.autocompleteMultiselect.mock.calls[0]?.[0]
    expect(options.initialValues).toEqual([])
    expect(
      options.options.map((option: { value: string }) => option.value),
    ).toEqual(['pkg#core', 'pkg#other', 'workspace:pkg#local'])
    expect(options.options[0].hint.length).toBeLessThanOrEqual(120)
    expect(api.select).toHaveBeenCalledOnce()
  })

  it.each(['packages', 'skills'])(
    'keeps an empty %s selection empty for deny-all confirmation',
    async (action) => {
      const api = runtime()
      api.select.mockResolvedValueOnce(action)
      await expect(
        createPermissionPrompts(api).selectPermissions([pkg]),
      ).resolves.toEqual([])
    },
  )

  it('only shows requested descriptions and can inspect exclusions without enabling anything', async () => {
    const api = runtime()
    api.select.mockResolvedValueOnce('inspect').mockResolvedValueOnce('skills')
    api.autocomplete
      .mockResolvedValueOnce(pkg.skills[2])
      .mockResolvedValueOnce('back')
    const output = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      await expect(
        createPermissionPrompts(api).selectPermissions([pkg]),
      ).resolves.toEqual([])
      expect(output.mock.calls.flat().join('\n')).toContain(
        'pkg#private — excluded by intent.exclude\nPrivate guidance',
      )
      expect(output.mock.calls.flat().join('\n')).not.toContain('Core guidance')
      expect(api.autocomplete.mock.calls[0]?.[0].options[3].label).toBe(
        'pkg#private (excluded)',
      )
    } finally {
      output.mockRestore()
    }
  })

  it('keeps update limitations optional without adding an approval prompt', async () => {
    const api = runtime()
    api.select.mockResolvedValueOnce('access').mockResolvedValueOnce('packages')
    const output = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      await expect(
        createPermissionPrompts(api).selectPermissions([pkg]),
      ).resolves.toEqual([])
      expect(output.mock.calls.flat().join('\n')).toContain(
        'Intent does not yet track or notify you about those changes.',
      )
    } finally {
      output.mockRestore()
    }
  })

  it.each(['start', 'packages', 'skills', 'inspect'])(
    'cancels once at %s',
    async (stage) => {
      const api = runtime()
      const canceled = Symbol('cancel')
      if (stage === 'start') api.select.mockResolvedValueOnce(canceled)
      else api.select.mockResolvedValueOnce(stage)
      if (stage === 'packages' || stage === 'skills')
        api.autocompleteMultiselect.mockResolvedValueOnce(canceled)
      if (stage === 'inspect') api.autocomplete.mockResolvedValueOnce(canceled)
      await expect(
        createPermissionPrompts(api).selectPermissions([pkg]),
      ).resolves.toBeNull()
      expect(api.cancel).toHaveBeenCalledOnce()
    },
  )

  it('offers optional review in the single final confirmation and defaults to cancel', async () => {
    const api = runtime()
    api.select
      .mockResolvedValueOnce('cancel')
      .mockResolvedValueOnce('save')
      .mockResolvedValueOnce('review')
    const prompts = createPermissionPrompts(api)
    await expect(prompts.confirmWrite(false)).resolves.toBe(false)
    await expect(prompts.confirmWrite(true)).resolves.toBe(true)
    await expect(prompts.confirmWrite(false)).resolves.toBe('review')
    expect(api.select.mock.calls[0]?.[0]).toMatchObject({
      initialValue: 'cancel',
      message: 'Save these permissions?',
    })
    expect(api.select.mock.calls[1]?.[0].message).toBe(
      'Disable all skills by writing intent.skills: []?',
    )
    api.select.mockResolvedValueOnce(Symbol('cancel'))
    await expect(prompts.confirmWrite(false)).resolves.toBeNull()
    expect(api.cancel).toHaveBeenCalledOnce()
  })

  it('offers explicit npm and workspace scope choices', async () => {
    const api = runtime()
    api.select.mockResolvedValueOnce('packages')
    api.autocompleteMultiselect.mockResolvedValueOnce(['@tanstack/*'])
    await expect(
      createPermissionPrompts(api).selectPermissions([
        { ...pkg, id: '@tanstack/ai' },
        { ...workspace, id: 'workspace:@tanstack/local' },
      ]),
    ).resolves.toEqual(['@tanstack/*'])
    expect(
      api.autocompleteMultiselect.mock.calls[0]?.[0].options.map(
        (option: { value: string }) => option.value,
      ),
    ).toEqual([
      '@tanstack/*',
      'workspace:@tanstack/*',
      '@tanstack/ai',
      'workspace:@tanstack/local',
    ])
  })

  it('offers only selected packages for review and opens skills only for chosen packages', async () => {
    const api = runtime()
    api.autocompleteMultiselect
      .mockResolvedValueOnce(['pkg'])
      .mockResolvedValueOnce(['pkg#core'])
    await expect(
      createPermissionPrompts(api).reviewPermissions([pkg, workspace], {
        skills: ['pkg'],
        exclude: [],
      }),
    ).resolves.toEqual({ skills: ['pkg'], exclude: ['pkg#other'] })
    expect(
      api.autocompleteMultiselect.mock.calls[0]?.[0].options.map(
        (option: { value: string }) => option.value,
      ),
    ).toEqual(['pkg'])
    expect(
      api.autocompleteMultiselect.mock.calls[1]?.[0].options.map(
        (option: { value: string }) => option.value,
      ),
    ).toEqual(['pkg#core', 'pkg#other'])
  })

  it('continues with every selected skill without opening any skill lists', async () => {
    const api = runtime()
    const selection = { skills: ['*'], exclude: ['pkg#other'] }
    await expect(
      createPermissionPrompts(api).reviewPermissions(
        [pkg, workspace],
        selection,
      ),
    ).resolves.toEqual(selection)
    expect(api.autocompleteMultiselect).toHaveBeenCalledOnce()
    expect(api.autocompleteMultiselect.mock.calls[0]?.[0]).toMatchObject({
      initialValues: [],
      required: false,
      placeholder: 'Leave empty to continue with all selected skills',
    })
  })

  it('keeps unreviewed packages and their exceptions unchanged', async () => {
    const api = runtime()
    api.autocompleteMultiselect
      .mockResolvedValueOnce(['workspace:pkg'])
      .mockResolvedValueOnce([])
    await expect(
      createPermissionPrompts(api).reviewPermissions([pkg, workspace], {
        skills: ['*'],
        exclude: ['pkg#other'],
      }),
    ).resolves.toEqual({ skills: ['*'], exclude: ['pkg#other', 'pkg#local'] })
    expect(api.autocompleteMultiselect).toHaveBeenCalledTimes(2)
    expect(
      api.autocompleteMultiselect.mock.calls[1]?.[0].options.map(
        (option: { value: string }) => option.value,
      ),
    ).toEqual(['workspace:pkg#local'])
  })

  it('keeps selected packages with all skills unchecked available for another review', async () => {
    const api = runtime()
    api.autocompleteMultiselect
      .mockResolvedValueOnce(['pkg'])
      .mockResolvedValueOnce(['pkg#other'])
    await expect(
      createPermissionPrompts(api).reviewPermissions([pkg, workspace], {
        skills: ['pkg'],
        exclude: ['pkg#core', 'pkg#other'],
      }),
    ).resolves.toEqual({ skills: ['pkg'], exclude: ['pkg#core'] })
    expect(
      api.autocompleteMultiselect.mock.calls[1]?.[0].initialValues,
    ).toEqual([])
  })

  it('cancels midway through reviewing multiple packages without returning partial changes', async () => {
    const api = runtime()
    api.autocompleteMultiselect
      .mockResolvedValueOnce(['pkg', 'workspace:pkg'])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(Symbol('cancel'))
    const selection = { skills: ['*'], exclude: [] }
    await expect(
      createPermissionPrompts(api).reviewPermissions(
        [pkg, workspace],
        selection,
      ),
    ).resolves.toBeNull()
    expect(selection).toEqual({ skills: ['*'], exclude: [] })
    expect(api.cancel).toHaveBeenCalledOnce()
  })

  it('can restore a skill excluded during review before saving', async () => {
    const api = runtime()
    api.autocompleteMultiselect
      .mockResolvedValueOnce(['pkg'])
      .mockResolvedValueOnce(['pkg#core', 'pkg#other'])
    await expect(
      createPermissionPrompts(api).reviewPermissions([pkg], {
        skills: ['pkg'],
        exclude: ['pkg#other'],
      }),
    ).resolves.toEqual({ skills: ['pkg'], exclude: [] })
    expect(
      api.autocompleteMultiselect.mock.calls[1]?.[0].initialValues,
    ).toEqual(['pkg#core'])
  })

  it('writes workspace exclusions using the kind-agnostic package name', async () => {
    const api = runtime()
    api.autocompleteMultiselect
      .mockResolvedValueOnce(['workspace:pkg'])
      .mockResolvedValueOnce([])
    await expect(
      createPermissionPrompts(api).reviewPermissions([workspace], {
        skills: ['workspace:pkg'],
        exclude: [],
      }),
    ).resolves.toEqual({ skills: ['workspace:pkg'], exclude: ['pkg#local'] })
  })

  it('does not broaden exact selections during review', async () => {
    const api = runtime()
    api.autocompleteMultiselect
      .mockResolvedValueOnce(['pkg'])
      .mockResolvedValueOnce(['pkg#core', 'pkg#other'])
    await expect(
      createPermissionPrompts(api).reviewPermissions([pkg], {
        skills: ['pkg#core'],
        exclude: [],
      }),
    ).resolves.toEqual({ skills: ['pkg#core', 'pkg#other'], exclude: [] })
  })

  it('cancels skill review without returning changes', async () => {
    const api = runtime()
    api.autocompleteMultiselect.mockResolvedValueOnce(Symbol('cancel'))
    await expect(
      createPermissionPrompts(api).reviewPermissions([pkg], {
        skills: ['*'],
        exclude: [],
      }),
    ).resolves.toBeNull()
    expect(api.cancel).toHaveBeenCalledOnce()
  })

  it('supports keyboard selection of a review package and only its individual skills', async () => {
    vi.stubEnv('TERM', 'xterm-256color')
    const input = new PassThrough()
    const output = Object.assign(new PassThrough(), { columns: 100, rows: 24 })
    const frames: Array<string> = []
    let rendered = ''
    let stage = 0
    output.on('data', (data) => {
      rendered += data.toString()
    })
    const api: ClackPermissionRuntime = {
      ...clack,
      autocompleteMultiselect: (options) => {
        rendered = ''
        const result = clack.autocompleteMultiselect({
          ...options,
          input,
          output,
        })
        const keys = stage++ === 0 ? 'pkg\t\r' : 'other\t\r'
        process.nextTick(() => {
          frames.push(stripVTControlCharacters(rendered))
          input.write(keys)
        })
        return result
      },
    }
    try {
      await expect(
        createPermissionPrompts(api).reviewPermissions([pkg, workspace], {
          skills: ['pkg'],
          exclude: [],
        }),
      ).resolves.toEqual({ skills: ['pkg'], exclude: ['pkg#other'] })
      expect(frames).toHaveLength(2)
      expect(frames[0]).toContain(
        'Leave empty to continue with all selected skills',
      )
      expect(frames[0]).not.toContain('workspace:pkg')
      expect(frames[0]).not.toContain('Core guidance')
      expect(frames[1]).toContain('Choose skills from pkg')
      expect(frames[1]).not.toContain('Workspace guidance')
      expect(frames[1]).not.toContain('private')
    } finally {
      vi.unstubAllEnvs()
      input.destroy()
      output.destroy()
    }
  })

  it('uses real search and keyboard selection for a bounded large package catalog', async () => {
    vi.stubEnv('TERM', 'xterm-256color')
    const input = new PassThrough()
    const output = Object.assign(new PassThrough(), { columns: 80, rows: 24 })
    let rendered = ''
    let firstFrame = ''
    output.on('data', (data) => {
      rendered += data.toString()
    })
    const packages = Array.from({ length: 14 }, (_, index) => ({
      id: `package-${index}`,
      version: '1.0.0',
      skills: pkg.skills.map((skill) => ({
        ...skill,
        id: `package-${index}#${skill.name}`,
      })),
    }))
    const api: ClackPermissionRuntime = {
      ...clack,
      select: (options) => {
        const result = clack.select({ ...options, input, output })
        process.nextTick(() => input.write('\x1b[B\r'))
        return result
      },
      autocompleteMultiselect: (options) => {
        rendered = ''
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
    }
    try {
      await expect(
        createPermissionPrompts(api).selectPermissions(packages),
      ).resolves.toEqual(['package-13'])
      expect(firstFrame.match(/[◻◼]/g)?.length).toBeLessThanOrEqual(6)
      expect(firstFrame).not.toContain('package-13')
      expect(firstFrame).not.toContain('Core guidance')
      expect(firstFrame.split('\n').length).toBeLessThan(20)
      expect(stripVTControlCharacters(rendered)).not.toContain(
        'Review selection',
      )
    } finally {
      vi.unstubAllEnvs()
      input.destroy()
      output.destroy()
    }
  })

  it('keeps inspection open when a search has no matches', async () => {
    vi.stubEnv('TERM', 'xterm-256color')
    const input = new PassThrough()
    const output = new PassThrough()
    let rendered = ''
    output.on('data', (data) => {
      rendered += data.toString()
    })
    const api = runtime()
    api.select.mockResolvedValueOnce('inspect')
    const prompts = createPermissionPrompts({
      ...api,
      autocomplete: (options) => {
        const result = clack.autocomplete({ ...options, input, output })
        process.nextTick(() => {
          input.write('no-such-skill\r')
          expect(stripVTControlCharacters(rendered)).toContain(
            'Choose a listed option or change your search.',
          )
          process.nextTick(() => input.write('\x03'))
        })
        return result
      },
      isCancel: clack.isCancel,
    })
    try {
      await expect(prompts.selectPermissions([pkg])).resolves.toBeNull()
      expect(api.cancel).toHaveBeenCalledOnce()
    } finally {
      vi.unstubAllEnvs()
      input.destroy()
      output.destroy()
    }
  })
})
