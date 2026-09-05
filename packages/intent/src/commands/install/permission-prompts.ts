import { stdin, stdout } from 'node:process'
import { stripVTControlCharacters } from 'node:util'
import {
  autocomplete,
  autocompleteMultiselect,
  cancel,
  isCancel,
  select,
} from '@clack/prompts'
import { selectedPermissionSkills } from './permissions.js'
import type { PermissionPackage, PermissionPrompts } from './permissions.js'

export interface ClackPermissionRuntime {
  autocomplete: typeof autocomplete
  autocompleteMultiselect: typeof autocompleteMultiselect
  cancel: typeof cancel
  isCancel: typeof isCancel
  select: typeof select
}

function descriptionHint(description: string): string {
  const text = stripVTControlCharacters(description).replace(/\s+/g, ' ').trim()
  return text.length > 120 ? `${text.slice(0, 117)}...` : text
}

export function createPermissionPrompts(
  runtime: ClackPermissionRuntime = {
    autocomplete,
    autocompleteMultiselect,
    cancel,
    isCancel,
    select,
  },
): PermissionPrompts {
  const io = { input: stdin, output: stdout }
  // Let Clack own search, scrolling, terminal sizing, and keyboard controls.
  const picker = { ...io, maxItems: 6 }
  const searchablePicker = {
    ...picker,
    validate: (value: unknown) =>
      value === undefined
        ? 'Choose a listed option or change your search.'
        : undefined,
  }
  const canceled = (value: unknown): value is symbol => {
    if (!runtime.isCancel(value)) return false
    runtime.cancel('Permissions: canceled.', { output: stdout })
    return true
  }

  return {
    selectPermissions: async (packages) => {
      const availablePackages = packages.filter((pkg) =>
        pkg.skills.some((skill) => !skill.excluded),
      )
      const availableSkills = packages
        .flatMap((pkg) => pkg.skills)
        .filter((skill) => !skill.excluded)

      for (;;) {
        const action = await runtime.select({
          ...picker,
          message: 'Which skills would you like to enable?',
          options: [
            {
              value: 'all',
              label: 'Enable all',
              hint: 'All npm and workspace sources, including future additions',
            },
            {
              value: 'packages',
              label: 'Choose packages or scopes',
              hint: 'Enable all skills in selected packages or scopes',
            },
            {
              value: 'skills',
              label: 'Choose individual skills',
              hint: 'Select specific skills instead',
            },
            { value: 'inspect', label: 'Inspect descriptions and exclusions' },
            { value: 'access', label: 'About skill access and updates' },
          ],
        })
        if (canceled(action)) return null
        if (action === 'all') return ['*']
        if (action === 'packages') {
          const selected = await runtime.autocompleteMultiselect({
            ...picker,
            message: 'Choose packages or scopes — type to filter',
            options: [
              ...[
                ...new Set(
                  availablePackages
                    .map((pkg) => pkg.id.match(/^(?:workspace:)?@[^/]+\//)?.[0])
                    .filter((scope): scope is string => scope !== undefined),
                ),
              ].map((scope) => ({
                value: `${scope}*`,
                label: `${scope}* (whole scope)`,
                hint: 'Includes future packages and skills in this scope',
              })),
              ...availablePackages.map((pkg) => {
                const count = pkg.skills.filter(
                  (skill) => !skill.excluded,
                ).length
                return {
                  value: pkg.id,
                  label: `${pkg.id} (${count} skill${count === 1 ? '' : 's'})`,
                  hint: pkg.version,
                }
              }),
            ],
            initialValues: [],
            required: false,
          })
          if (canceled(selected)) return null
          return selected
        }
        if (action === 'skills') {
          const selected = await runtime.autocompleteMultiselect({
            ...picker,
            message:
              'Choose individual skills — type a package or skill name to filter',
            options: availableSkills.map((skill) => ({
              value: skill.id,
              label: skill.id,
              hint: descriptionHint(skill.description),
            })),
            initialValues: [],
            required: false,
          })
          return canceled(selected) ? null : selected
        }
        if (action === 'access') {
          console.log('Enabled skills can provide instructions to AI agents.')
          console.log(
            'Package and scope rules include future skills in matching sources. Exact skill entries enable only that name. Exclusions always apply.',
          )
          console.log(
            'Skill instructions can change when dependencies update. Intent does not yet track or notify you about those changes.',
          )
          continue
        }
        for (;;) {
          const skill = await runtime.autocomplete<
            PermissionPackage['skills'][number] | 'back'
          >({
            ...searchablePicker,
            message: 'Inspect a skill — type a package or skill name to filter',
            options: [
              { value: 'back', label: 'Back to setup' },
              ...packages
                .flatMap((pkg) => pkg.skills)
                .map((entry) => ({
                  value: entry,
                  label: `${entry.id}${entry.excluded ? ' (excluded)' : ''}`,
                  hint: entry.excluded
                    ? 'Unavailable because of intent.exclude'
                    : descriptionHint(entry.description),
                })),
            ],
          })
          if (canceled(skill)) return null
          if (skill === 'back') break
          console.log(
            `\n${skill.id}${skill.excluded ? ' — excluded by intent.exclude' : ''}`,
          )
          console.log(stripVTControlCharacters(skill.description))
        }
      }
    },
    reviewPermissions: async (packages, selection) => {
      const available = packages
        .flatMap((pkg) => pkg.skills)
        .filter((skill) => !skill.excluded)
      const selected = await runtime.autocompleteMultiselect({
        ...picker,
        message: 'Review individual skills — uncheck to exclude',
        options: available.map((skill) => ({
          value: skill.id,
          label: skill.id,
          hint: descriptionHint(skill.description),
        })),
        initialValues: selectedPermissionSkills(packages, selection).map(
          (skill) => skill.id,
        ),
        required: false,
      })
      if (canceled(selected)) return null
      const broad = selection.skills.filter((skill) => !skill.includes('#'))
      const covered = new Set(
        selectedPermissionSkills(packages, { skills: broad, exclude: [] }).map(
          (skill) => skill.id,
        ),
      )
      return {
        skills: [...broad, ...selected.filter((id) => !covered.has(id))],
        // Exclusions are package-name based for both npm and workspace sources.
        exclude: [...covered]
          .filter((id) => !selected.includes(id))
          .map((id) => id.replace(/^workspace:/, '')),
      }
    },
    confirmWrite: async (denyAll) => {
      const result = await runtime.select({
        ...picker,
        message: denyAll
          ? 'Disable all skills by writing intent.skills: []?'
          : 'Save these permissions?',
        initialValue: 'cancel',
        options: [
          {
            value: 'save',
            label: denyAll ? 'Disable all skills' : 'Enable selected skills',
          },
          { value: 'review', label: 'Review individual skills' },
          { value: 'cancel', label: 'Cancel' },
        ],
      })
      if (canceled(result)) return null
      return result === 'review' ? 'review' : result === 'save'
    },
  }
}
