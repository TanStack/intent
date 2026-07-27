import { cancel, isCancel, outro, select } from '@clack/prompts'
import { selectClackSkills } from '../install/prompts.js'
import type { NewDependencyDecision, SyncReviewPrompter } from './command.js'

export function createClackSyncReviewPrompter(): SyncReviewPrompter {
  return {
    complete(message: string): void {
      outro(message)
    },
    async reviewNewDependencies(): Promise<NewDependencyDecision | null> {
      const decision = await select<NewDependencyDecision>({
        message: 'How do you want to handle these pending skills?',
        options: [
          { value: 'review', label: 'Review and install' },
          { value: 'exclude', label: 'Exclude pending skills' },
          { value: 'later', label: 'Remind me later' },
        ],
      })
      if (!isCancel(decision)) return decision
      cancel('Sync review cancelled. Pending skills remain pending review.')
      return null
    },
    async selectSkills(packages) {
      const selection = await selectClackSkills(packages, false)
      return selection?.mode === 'individual' ? selection : null
    },
  }
}
