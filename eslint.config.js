// @ts-check

import { tanstackConfig } from '@tanstack/eslint-config'
import unusedImports from 'eslint-plugin-unused-imports'

/** @type {import('eslint').Linter.Config[]} */
const config = [
  ...tanstackConfig,
  {
    name: 'tanstack/temp',
    plugins: {
      'unused-imports': unusedImports,
    },
    rules: {
      'no-case-declarations': 'off',
      'no-shadow': 'off',
      'unused-imports/no-unused-imports': 'warn',
      'pnpm/enforce-catalog': 'off',
      'pnpm/json-enforce-catalog': 'off',
    },
  },
  {
    name: 'intent/policed-scanner-import',
    files: ['packages/intent/src/**/*.ts'],
    ignores: [
      'packages/intent/src/index.ts',
      'packages/intent/src/core/source-policy.ts',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/scanner.js', './scanner.js', '../scanner.js'],
              importNames: ['scanForIntents'],
              message:
                'Import scanForPolicedIntents from core/source-policy.js; the raw scanForIntents must not be used by internal consumers.',
            },
          ],
        },
      ],
    },
  },
  {
    name: 'intent/static-discovery',
    files: [
      'packages/intent/src/scanner.ts',
      'packages/intent/src/lockfile.ts',
      'packages/intent/src/manifest.ts',
      'packages/intent/src/mcp/**/*.ts',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "ImportExpression[source.type!='Literal']",
          message:
            'Static-discovery invariant: no dynamic import() of a computed path in discovery code.',
        },
        {
          selector:
            "CallExpression[callee.name=/[rR]equire/][callee.name!='createRequire'][arguments.0.type!='Literal']",
          message:
            'Static-discovery invariant: no require() of a computed path in discovery code.',
        },
        {
          selector:
            "CallExpression[callee.property.name='resolve'][callee.object.callee.name='createRequire']",
          message:
            'Static-discovery invariant: createRequire().resolve is limited to package.json targets (disable inline for that case).',
        },
      ],
    },
  },
]

export default config
