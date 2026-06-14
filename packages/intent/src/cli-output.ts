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
  if (shouldSuppressNotices(options)) return

  console.error('Notices:')
  for (const notice of notices) {
    console.error(`  ℹ ${notice}`)
  }
}
