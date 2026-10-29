import { describe, expect, it } from 'vitest'
import {
  invocationPrefix,
  transformCommands,
} from '../src/transforms/commands.js'

const base = {
  env: {},
  ancestors: [],
  scripts: {},
  executable: '/usr/bin/node',
  script: '/tools/intent/cli.mjs',
}

describe('transform command instructions', () => {
  it('preserves npx tags and fixed versions recovered from npm', () => {
    for (const spec of [
      '@tanstack/intent@latest',
      '@tanstack/intent@0.5.6',
      '@tanstack/intent',
    ]) {
      expect(
        invocationPrefix({
          ...base,
          ancestors: [`npm exec ${spec} load example#guide`],
        }),
      ).toBe(`npx ${spec}`)
    }
  })
  it('preserves npm scripts and the argument forwarding separator', () => {
    const prefix = invocationPrefix({
      ...base,
      env: {
        npm_command: 'run-script',
        npm_lifecycle_event: 'intent',
        npm_lifecycle_script: 'intent',
      },
    })
    expect(
      transformCommands('example#guide', { commandPrefix: prefix }),
    ).toEqual({
      load: "npm run 'intent' -- load 'example#guide'",
      configure: "npm run 'intent' -- configure 'example#guide'",
    })
  })
  it('recovers an outer script when nested npx has replaced lifecycle metadata', () => {
    expect(
      invocationPrefix({
        ...base,
        env: { npm_lifecycle_event: 'npx' },
        scripts: { intent: 'npx @tanstack/intent@latest' },
        ancestors: [
          'npm exec @tanstack/intent@latest load example#guide',
          'npm run intent load example#guide',
        ],
      }),
    ).toBe("npm run 'intent' --")
  })
  it('does not reuse scripts with a fixed action or compound shell commands', () => {
    for (const script of ['intent load example#guide', 'intent && echo done']) {
      expect(
        invocationPrefix({
          ...base,
          env: { npm_lifecycle_event: 'intent', npm_lifecycle_script: script },
        }),
      ).toBe("'/usr/bin/node' '/tools/intent/cli.mjs'")
    }
  })
  it('preserves other known package manager launchers', () => {
    expect(
      invocationPrefix({
        ...base,
        ancestors: ['pnpm dlx @tanstack/intent@latest load example#guide'],
      }),
    ).toBe('pnpm dlx @tanstack/intent@latest')
    expect(
      invocationPrefix({
        ...base,
        env: {
          npm_config_user_agent: 'pnpm/11',
          npm_lifecycle_event: 'intent',
          npm_lifecycle_script: 'intent',
        },
      }),
    ).toBe("pnpm run 'intent'")
  })
  it('uses exec package metadata or the actual executable without guessing latest', () => {
    expect(
      invocationPrefix({
        ...base,
        env: {
          npm_command: 'exec',
          npm_config_package: '@tanstack/intent@0.5.6',
        },
      }),
    ).toBe('npx @tanstack/intent@0.5.6')
    expect(invocationPrefix(base)).toBe(
      "'/usr/bin/node' '/tools/intent/cli.mjs'",
    )
  })
  it('quotes identities and retains resolution scope without replaying output flags or answers', () => {
    expect(
      transformCommands("pkg#skill'$(echo unsafe)", {
        commandPrefix: 'npx @tanstack/intent@latest',
        globalOnly: true,
      }),
    ).toEqual({
      load: "npx @tanstack/intent@latest load 'pkg#skill'\\''$(echo unsafe)' --global-only",
      configure:
        "npx @tanstack/intent@latest configure 'pkg#skill'\\''$(echo unsafe)' --global-only",
    })
  })
})
