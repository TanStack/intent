export function printWarnings(warnings: Array<string>): void {
  if (warnings.length === 0) return

  console.log('Warnings:')
  for (const warning of warnings) {
    console.log(`  ⚠ ${warning}`)
  }
}

export function printNotices(notices: Array<string>): void {
  if (notices.length === 0) return

  console.error('Notices:')
  for (const notice of notices) {
    console.error(`  ℹ ${notice}`)
  }
}
