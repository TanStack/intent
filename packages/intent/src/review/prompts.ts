import { stdin, stdout } from 'node:process'
import { stripVTControlCharacters } from 'node:util'
import { confirm, isCancel, select, text } from '@clack/prompts'
import type { ReviewDecision, ReviewPrompts } from './interactive.js'

export function createReviewPrompts(): ReviewPrompts {
  const io = { input: stdin, output: stdout }
  const required = (value: string | undefined) =>
    value?.trim() ? undefined : 'Enter the review evidence.'
  return {
    async reviewItem(item, inspect) {
      console.log(`\n${item.kind}: ${JSON.stringify(item.path)}`)
      for (const problem of item.problems)
        console.log(`  Unresolved: ${stripVTControlCharacters(problem)}`)
      for (const path of item.changedFiles)
        console.log(`  Changed: ${JSON.stringify(path)}`)
      for (;;) {
        const action = await select({
          ...io,
          message: `Review ${JSON.stringify(item.path)}`,
          initialValue: 'changes',
          options: [
            { value: 'changes', label: 'View source and guidance changes' },
            {
              value: 'guidance',
              label: 'View current guidance',
              disabled: item.kind === 'source',
            },
            {
              value: 'updated',
              label: 'Record updated guidance',
              disabled: item.problems.length > 0,
            },
            {
              value: 'no-change',
              label: 'Record justified no change',
              disabled: item.problems.length > 0,
            },
            ...(item.kind === 'planning'
              ? []
              : [
                  {
                    value: 'out-of-scope',
                    label: 'Record justified out of scope',
                    disabled: item.problems.length > 0,
                  },
                ]),
            { value: 'unresolved', label: 'Leave pending' },
          ],
        })
        if (isCancel(action)) return null
        if (action === 'changes' || action === 'guidance') {
          console.log(stripVTControlCharacters(inspect(action)))
          continue
        }
        if (action === 'unresolved') return { outcome: 'unresolved' }
        const reason = await text({
          ...io,
          message: 'Reason for this outcome',
          validate: required,
        })
        if (isCancel(reason)) return null
        const evidence = await text({
          ...io,
          message: 'Evidence (source or command and actual result)',
          validate: required,
        })
        if (isCancel(evidence)) return null
        return {
          outcome: action as Exclude<ReviewDecision['outcome'], 'unresolved'>,
          reason: reason.trim(),
          evidence: [evidence.trim()],
        }
      }
    },
    async confirm(report) {
      const resolved = report.items.filter(
        (item) => item.outcome !== 'unresolved',
      )
      for (const item of resolved) {
        console.log(`\n${JSON.stringify(item.path)}: ${item.outcome}`)
        console.log(`  ${stripVTControlCharacters(item.reason ?? '')}`)
        for (const evidence of item.evidence ?? [])
          console.log(`  Evidence: ${stripVTControlCharacters(evidence)}`)
      }
      const answer = await confirm({
        ...io,
        message: `Record ${resolved.length} outcome(s), leaving ${report.items.length - resolved.length} pending?`,
        initialValue: false,
      })
      return !isCancel(answer) && answer
    },
  }
}
