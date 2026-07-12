import { isEnvFlagSet } from './env-flag.js'

// Lives here (not core/source-policy.ts) so printNotices can enforce
// non-suppressibility by identity without core importing this module.
export const ALLOW_ALL_NOTICE =
  'All skill sources allowed (intent.skills: ["*"]) — unvetted skills may be surfaced into agent guidance.'

function escapeUnsafeUnicode(value: string): string {
  return value.replace(
    /[\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/gu,
    (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`,
  )
}

export function formatReviewJson(value: unknown): string {
  return escapeUnsafeUnicode(String(JSON.stringify(value)))
}

export function escapeReviewValue(value: string): string {
  // JSON escaping neutralizes terminal control bytes. Escape additional
  // bidi/C1 controls that JSON permits literally so untrusted skill content
  // and paths cannot visually reorder or overwrite CLI output.
  return formatReviewJson(value).slice(1, -1)
}

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

function envSuppressesNotices(): boolean {
  return isEnvFlagSet('INTENT_NO_NOTICES')
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
