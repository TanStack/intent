import { applyEdits, modify, parse } from 'jsonc-parser'

function formattingOptions(text: string): {
  eol: string
  insertSpaces: boolean
  tabSize: number
} {
  const indentation = /\n([ \t]+)"/.exec(text)?.[1] ?? '  '
  return {
    eol: text.includes('\r\n') ? '\r\n' : '\n',
    insertSpaces: !indentation.includes('\t'),
    tabSize: indentation.includes('\t') ? 1 : indentation.length,
  }
}

function containsIntentSync(value: string): boolean {
  return value
    .split('&&')
    .some((segment) => /^\s*intent sync(?:\s|$)/.test(segment))
}

export function wireIntentSyncPrepare(text: string): string {
  const errors: Array<{ error: number; offset: number; length: number }> = []
  const bom = text.startsWith('\ufeff') ? '\ufeff' : ''
  const body = bom ? text.slice(1) : text
  const value = parse(body, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  }) as Record<string, unknown> | null
  if (errors.length > 0 || !value || typeof value !== 'object') {
    throw new Error('Invalid package.json JSONC.')
  }
  const scripts = value.scripts
  const prepare =
    scripts && typeof scripts === 'object' && !Array.isArray(scripts)
      ? (scripts as Record<string, unknown>).prepare
      : undefined
  if (typeof prepare === 'string' && containsIntentSync(prepare)) return text
  const next =
    typeof prepare === 'string' && prepare.trim()
      ? `${prepare} && intent sync`
      : 'intent sync'
  const updated = applyEdits(
    body,
    modify(body, ['scripts', 'prepare'], next, {
      formattingOptions: formattingOptions(body),
    }),
  )
  return `${bom}${updated}`
}
