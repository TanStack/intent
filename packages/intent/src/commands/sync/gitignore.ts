const START = '# intent skill links:start'
const END = '# intent skill links:end'

export function updateIntentGitignore(
  text: string | null,
  paths: ReadonlyArray<string>,
): string {
  const eol = text?.includes('\r\n') ? '\r\n' : '\n'
  const prefix = text ?? ''
  const entries = [...new Set(paths)].sort()
  const block = [START, ...entries, END].join(eol)
  const matcher = new RegExp(
    `${START.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${END.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
  )
  if (matcher.test(prefix)) return prefix.replace(matcher, block)
  if (prefix === '') return `${block}${eol}`
  const separator = prefix.endsWith('\n') ? '' : eol
  return `${prefix}${separator}${block}${eol}`
}
