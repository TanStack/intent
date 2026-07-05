// Lives here (not core/source-policy.ts) so printNotices can enforce
// non-suppressibility by identity without core importing this module.
export const ALLOW_ALL_NOTICE =
  'All skill sources allowed (intent.skills: ["*"]) — unvetted skills may be surfaced into agent guidance.'

export function printWarnings(warnings: Array<string>): void {
  if (warnings.length === 0) return

  console.log('Warnings:')
  for (const warning of warnings) {
    console.log(`  ⚠ ${warning}`)
  }
}

export interface NoticeOutputOptions {
  noNotices?: boolean
}

const TRUE_LIKE_VALUES = new Set(['1', 'true', 'yes', 'on'])

function envSuppressesNotices(): boolean {
  const value = process.env.INTENT_NO_NOTICES?.trim().toLowerCase()
  return value ? TRUE_LIKE_VALUES.has(value) : false
}

function shouldSuppressNotices(options: NoticeOutputOptions = {}): boolean {
  return options.noNotices === true || envSuppressesNotices()
}

export function printNotices(
  notices: Array<string>,
  options: NoticeOutputOptions = {},
): void {
  if (notices.length === 0) return

  // ALLOW_ALL_NOTICE stays visible even when suppressed: agent hooks read
  // warnings/conflicts but never notices, so keeping it here (rather than in
  // warnings) also keeps it out of agent-injected context automatically.
  const visible = shouldSuppressNotices(options)
    ? notices.filter((notice) => notice === ALLOW_ALL_NOTICE)
    : notices
  if (visible.length === 0) return

  console.error('Notices:')
  for (const notice of visible) {
    console.error(`  ℹ ${notice}`)
  }
}
