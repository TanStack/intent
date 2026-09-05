import { stdin, stdout } from 'node:process'
import { stripVTControlCharacters } from 'node:util'
import {
  autocomplete,
  autocompleteMultiselect,
  cancel,
  confirm,
  isCancel,
  select,
} from '@clack/prompts'
import type { PermissionPackage, PermissionPrompts } from './permissions.js'

export interface ClackPermissionRuntime {
  autocomplete: typeof autocomplete
  autocompleteMultiselect: typeof autocompleteMultiselect
  cancel: typeof cancel
  confirm: typeof confirm
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
    confirm,
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
    selectPermissions: async (packages, packageJsonPath) => {
      let selected: Array<string> = []
      const available = (pkg: PermissionPackage) =>
        pkg.skills.filter((skill) => !skill.excluded)
      const selectionLabel = (pkg: PermissionPackage): string => {
        if (selected.includes(pkg.id)) return 'all current and future skills'
        const count = pkg.skills.filter((skill) =>
          selected.includes(skill.id),
        ).length
        return count > 0
          ? `${count} individual skill${count === 1 ? '' : 's'} selected`
          : 'none selected'
      }
      const replaceSelection = (
        pkg: PermissionPackage,
        values: Array<string>,
      ) => {
        selected = selected.filter(
          (value) => value !== pkg.id && !value.startsWith(`${pkg.id}#`),
        )
        selected.push(...values)
      }

      const choosePackages = async (): Promise<boolean> => {
        const result = await runtime.autocompleteMultiselect({
          ...picker,
          message: 'Choose packages — allows their current and future skills',
          options: packages
            .filter((pkg) => available(pkg).length > 0)
            .map((pkg) => ({
              value: pkg.id,
              label: `${pkg.id} (${available(pkg).length} skill${available(pkg).length === 1 ? '' : 's'})`,
              hint: pkg.version,
            })),
          initialValues: selected.filter((value) => !value.includes('#')),
          required: false,
        })
        if (canceled(result)) return false
        // Revisiting package choices must not discard existing exact selections.
        const packageIds = result
        selected = selected.filter(
          (value) =>
            value.includes('#') &&
            !packageIds.some((id) => value.startsWith(`${id}#`)),
        )
        selected.push(...packageIds)
        return true
      }

      if (!(await choosePackages())) return null

      for (;;) {
        const selectedPackages = packages.filter((pkg) =>
          selected.includes(pkg.id),
        ).length
        const selectedSkills = selected.filter((value) =>
          value.includes('#'),
        ).length
        const action = await runtime.autocomplete<string | PermissionPackage>({
          ...searchablePicker,
          message: `Review permissions — packages: ${selectedPackages}, individual skills: ${selectedSkills}`,
          options: [
            {
              value: 'continue',
              label: 'Continue to confirmation',
              hint: 'Nothing is saved yet',
            },
            ...[...packages]
              .sort((left, right) => {
                const hasSelection = (pkg: PermissionPackage) =>
                  selected.some(
                    (value) =>
                      value === pkg.id || value.startsWith(`${pkg.id}#`),
                  )
                return Number(hasSelection(right)) - Number(hasSelection(left))
              })
              .map((pkg) => ({
                value: pkg,
                label: `${pkg.id} — ${selectionLabel(pkg)}`,
                hint: `${pkg.version}; ${available(pkg).length} available, ${pkg.skills.length - available(pkg).length} excluded. Enter to inspect or edit.`,
              })),
            { value: 'packages', label: 'Change package selections' },
            { value: 'config', label: 'Show exact configuration' },
            {
              value: 'all',
              label: 'Advanced: allow all current and future sources',
            },
          ],
        })
        if (canceled(action)) return null
        if (action === 'continue') return selected
        if (action === 'packages') {
          if (!(await choosePackages())) return null
          continue
        }
        if (action === 'config') {
          console.log(`Permission destination: ${packageJsonPath}`)
          console.log(
            `intent.skills: ${JSON.stringify([...selected].sort(), null, 2)}`,
          )
          continue
        }
        if (action === 'all') {
          const confirmed = await runtime.confirm({
            ...io,
            message:
              'Allow all current and future npm and workspace skill sources?',
            initialValue: false,
          })
          if (canceled(confirmed)) return null
          if (confirmed === true) return ['*']
          continue
        }

        if (typeof action === 'string') continue
        const pkg = action
        let editing = true
        while (editing) {
          const choice = await runtime.select({
            ...picker,
            message: `${pkg.id} — ${selectionLabel(pkg)}`,
            options: [
              { value: 'back', label: 'Back to review' },
              {
                value: 'skills',
                label: 'Choose individual skills',
                hint: 'Only these skills; future additions are not included',
                disabled: available(pkg).length === 0,
              },
              {
                value: 'all',
                label: 'Allow all current and future skills in this package',
                disabled: available(pkg).length === 0,
              },
              {
                value: 'none',
                label: 'Remove this package from the selection',
              },
              {
                value: 'details',
                label: 'Inspect skill descriptions and exclusions',
                hint: 'Viewing details does not change permissions',
              },
            ],
          })
          if (canceled(choice)) return null
          if (choice === 'back') break
          if (choice === 'all' || choice === 'none') {
            replaceSelection(pkg, choice === 'all' ? [pkg.id] : [])
            break
          }
          if (choice === 'skills') {
            const skills = available(pkg)
            const result = await runtime.autocompleteMultiselect({
              ...picker,
              message: `${pkg.id} — choose individual skills`,
              options: skills.map((skill) => ({
                value: skill.id,
                label: skill.name,
                hint: descriptionHint(skill.description),
              })),
              initialValues: selected.includes(pkg.id)
                ? skills.map((skill) => skill.id)
                : skills
                    .filter((skill) => selected.includes(skill.id))
                    .map((skill) => skill.id),
              required: false,
            })
            if (canceled(result)) return null
            replaceSelection(pkg, result)
            editing = false
          }
          if (choice === 'details') {
            for (;;) {
              const skill = await runtime.autocomplete<
                PermissionPackage['skills'][number] | 'back'
              >({
                ...searchablePicker,
                message: `${pkg.id} — inspect a skill`,
                options: [
                  { value: 'back', label: 'Back to package' },
                  ...pkg.skills.map((entry) => ({
                    value: entry,
                    label: `${entry.name}${entry.excluded ? ' (excluded)' : ''}`,
                    hint: entry.excluded
                      ? 'Unavailable because of intent.exclude'
                      : descriptionHint(entry.description),
                  })),
                ],
              })
              if (canceled(skill)) return null
              if (skill === 'back') break
              const entry = skill
              console.log(
                `\n${entry.id}${entry.excluded ? ' — excluded by intent.exclude' : ''}`,
              )
              console.log(stripVTControlCharacters(entry.description))
            }
          }
        }
      }
    },
    confirmWrite: async (denyAll) => {
      const result = await runtime.confirm({
        ...io,
        message: denyAll
          ? 'Disable all skills by writing intent.skills: []?'
          : 'Write this permission configuration?',
        initialValue: false,
      })
      return canceled(result) ? null : result
    },
  }
}
