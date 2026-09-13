import { stdin, stdout } from 'node:process'
import { stripVTControlCharacters } from 'node:util'
import {
  autocompleteMultiselect,
  confirm,
  isCancel,
  select,
  text,
} from '@clack/prompts'
import type { AdoptionPrompts } from './adopt.js'

export function createAdoptionPrompts(): AdoptionPrompts {
  const io = { input: stdin, output: stdout }
  return {
    async choose(plan) {
      const available = plan.skills.filter(
        (skill) => skill.status === 'unregistered',
      )
      if (available.length) {
        const selected = await autocompleteMultiselect({
          ...io,
          message: 'Choose existing library skills to register',
          options: available.map((skill) => ({
            value: skill.id,
            label: skill.name,
            hint: stripVTControlCharacters(skill.id),
          })),
          initialValues: [],
          required: false,
          maxItems: 6,
        })
        if (isCancel(selected)) return null
        for (const skill of available) {
          skill.selected = selected.includes(skill.id)
          if (!skill.selected || skill.domain.trim()) continue
          const domain = await text({
            ...io,
            message: `Domain for ${skill.name}`,
            validate: (value) =>
              value?.trim() ? undefined : 'Enter the task domain.',
          })
          if (isCancel(domain)) return null
          skill.domain = domain.trim()
        }
      }
      const mode = await select({
        ...io,
        message: 'Repository distribution',
        initialValue: 'keep',
        options: [
          {
            value: 'keep',
            label:
              plan.distribution.mode === 'unconfigured'
                ? 'Decide later'
                : `Keep current choice (${plan.distribution.mode})`,
          },
          { value: 'repo', label: 'Choose skills for repository distribution' },
          { value: 'none', label: 'Package-only distribution' },
        ],
      })
      if (isCancel(mode)) return null
      if (mode === 'none') plan.distribution = { mode: 'none' }
      if (mode === 'repo') {
        const candidates = plan.skills.filter(
          (skill) => skill.status === 'registered' || skill.selected,
        )
        if (!candidates.length)
          throw new Error(
            'Select skills to register before configuring exports.',
          )
        const selected = await autocompleteMultiselect({
          ...io,
          message: 'Select repository exports and their local prerequisites',
          options: candidates.map((skill) => ({
            value: skill.name,
            label: skill.name,
            hint: stripVTControlCharacters(skill.id),
          })),
          initialValues:
            'skills' in plan.distribution ? plan.distribution.skills : [],
          required: true,
          maxItems: 6,
        })
        if (isCancel(selected)) return null
        let repository = plan.distribution.repository ?? ''
        if (!repository) {
          const answer = await text({
            ...io,
            message: 'GitHub repository (owner/repo)',
            validate: (value) =>
              value?.trim() ? undefined : 'Enter the GitHub repository.',
          })
          if (isCancel(answer)) return null
          repository = answer.trim()
        }
        plan.distribution = {
          ...plan.distribution,
          mode: 'repo',
          repository,
          skills: selected,
        }
      }
      return plan
    },
    async confirm(plan, files) {
      console.log('\nProposed registrations:')
      for (const skill of plan.skills.filter((entry) => entry.selected))
        console.log(
          stripVTControlCharacters(`  ${skill.id} -> ${skill.domain}`),
        )
      console.log(`Distribution: ${plan.distribution.mode}`)
      console.log('Planning files:')
      for (const file of files)
        console.log(`  ${stripVTControlCharacters(file)}`)
      const answer = await confirm({
        ...io,
        message: 'Apply these choices and install maintainer guidance?',
        initialValue: false,
      })
      return !isCancel(answer) && answer
    },
  }
}
