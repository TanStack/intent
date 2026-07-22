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
        message: 'How do you want to handle these dependencies?',
        options: [
          { value: 'review', label: 'Review and install' },
          { value: 'exclude', label: 'Exclude these packages' },
          { value: 'later', label: 'Remind me later' },
        ],
      })
      if (!isCancel(decision)) return decision
      cancel('Sync review cancelled. New dependencies remain pending.')
      return null
    },
    selectSkills(packages) {
      return selectClackSkills(packages, false)
    },
  }
}
