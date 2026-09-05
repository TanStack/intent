import { stdin, stdout } from 'node:process'
import { stripVTControlCharacters } from 'node:util'
import {
  autocomplete,
  autocompleteMultiselect,
  cancel,
  isCancel,
  select,
} from '@clack/prompts'
import { compileExcludePatterns, isSkillExcluded } from '../../core/excludes.js'
import { parseSkillSources } from '../../core/skill-sources.js'
import { compileSkillSourcePolicy } from '../../core/source-policy.js'
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

  const prompts: PermissionPrompts = {
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
    editPermissions: async (packages, initial) => {
      let selection = {
        skills: [...initial.skills],
        exclude: [...initial.exclude],
      }
      const allSkills = packages.flatMap((pkg) => pkg.skills)
      for (;;) {
        const action = await runtime.select({
          ...picker,
          message: 'Review current skill permissions',
          options: [
            { value: 'continue', label: 'Continue to confirmation' },
            { value: 'add', label: 'Add packages, scopes, or skills' },
            { value: 'remove', label: 'Remove permission rules' },
            { value: 'skills', label: 'Review individual skills' },
            { value: 'inspect', label: 'Inspect access and descriptions' },
            { value: 'preview', label: 'Show exact proposed configuration' },
          ],
        })
        if (canceled(action)) return null
        if (action === 'continue') return selection
        if (action === 'add') {
          if (!allSkills.some((skill) => !skill.excluded)) {
            console.log(
              'No selectable skills discovered. Install a package with skills or review intent.exclude, then retry.',
            )
            continue
          }
          const added = await prompts.selectPermissions(packages)
          if (added === null) return null
          // Preserve existing rules verbatim, including rules not discovered today.
          const existing = new Set(selection.skills)
          const policy = compileSkillSourcePolicy(
            parseSkillSources(selection.skills),
          )
          const additions = added.filter((rule) => {
            if (existing.has(rule)) return false
            const parsed = parseSkillSources([rule])
            if (parsed.mode !== 'explicit')
              return (
                parsed.mode === 'allow-all' && !selection.skills.includes('*')
              )
            const source = parsed.sources[0]!
            if (source.kind === 'git' || 'pattern' in source)
              return !selection.skills.includes('*')
            // A collection of exact skills does not grant future package skills.
            return (
              !policy.matchers.some(
                (matcher) =>
                  matcher.matchesPackage(source.id, source.kind) &&
                  (!('skill' in matcher.source) ||
                    matcher.source.skill === undefined ||
                    matcher.source.skill === source.skill),
              ) && !selection.skills.includes('*')
            )
          })
          selection = {
            ...selection,
            skills: [...selection.skills, ...additions],
          }
        } else if (action === 'remove') {
          if (selection.skills.length === 0) {
            console.log(
              'No permission rules to remove. Add packages or skills to enable them.',
            )
            continue
          }
          const policy = compileSkillSourcePolicy(
            parseSkillSources(selection.skills.filter((rule) => rule !== '*')),
          )
          const kept = await runtime.autocompleteMultiselect({
            ...picker,
            message: 'Keep permission rules — uncheck to remove',
            options: selection.skills.map((rule) => {
              const matcher = policy.matchers.find(
                (entry) => entry.source.raw === rule,
              )
              const skillName =
                matcher && 'skill' in matcher.source
                  ? matcher.source.skill
                  : undefined
              const discovered =
                rule === '*' ||
                packages.some((pkg) => {
                  const kind = pkg.id.startsWith('workspace:')
                    ? 'workspace'
                    : 'npm'
                  const name = pkg.id.replace(/^workspace:/, '')
                  return (
                    matcher?.matchesPackage(name, kind) &&
                    (skillName === undefined ||
                      pkg.skills.some((skill) => skill.name === skillName))
                  )
                })
              return {
                value: rule,
                label: rule,
                hint: discovered
                  ? undefined
                  : 'Not discovered; kept unless you remove it',
              }
            }),
            initialValues: selection.skills,
            required: false,
          })
          if (canceled(kept)) return null
          const retained = new Set(kept)
          selection = {
            ...selection,
            skills: selection.skills.filter((rule) => retained.has(rule)),
          }
        } else if (action === 'skills') {
          const reviewed = await prompts.reviewPermissions(packages, selection)
          if (reviewed === null) return null
          selection = reviewed
        } else if (action === 'preview') {
          console.log(
            `intent.skills: ${JSON.stringify(selection.skills, null, 2)}`,
          )
          console.log(
            `Add to intent.exclude: ${JSON.stringify(selection.exclude, null, 2)}`,
          )
          console.log(
            'Existing exclusions remain in effect. Skill content changes are not tracked.',
          )
        } else {
          const config = parseSkillSources(selection.skills)
          const policy = compileSkillSourcePolicy(config)
          const excludes = compileExcludePatterns(selection.exclude)
          const reasons = new Map<string, string>()
          for (const pkg of packages) {
            const kind = pkg.id.startsWith('workspace:') ? 'workspace' : 'npm'
            const name = pkg.id.replace(/^workspace:/, '')
            for (const skill of pkg.skills) {
              const matcher = policy.matchers.find(
                (entry) =>
                  entry.matchesPackage(name, kind) &&
                  (!('skill' in entry.source) ||
                    entry.source.skill === undefined ||
                    entry.source.skill === skill.name),
              )
              reasons.set(
                skill.id,
                skill.excluded || isSkillExcluded(name, skill.name, excludes)
                  ? 'Blocked by intent.exclude'
                  : config.mode === 'allow-all'
                    ? 'Permitted by * (all sources)'
                    : config.mode === 'empty'
                      ? 'Blocked by intent.skills: []'
                      : matcher
                        ? `Permitted by ${matcher.source.raw}`
                        : 'Blocked: no matching intent.skills rule',
              )
            }
          }
          for (;;) {
            const skill = await runtime.autocomplete<
              PermissionPackage['skills'][number] | 'back'
            >({
              ...searchablePicker,
              message: 'Inspect current access — type to filter',
              options: [
                { value: 'back', label: 'Back to permission review' },
                ...allSkills.map((entry) => ({
                  value: entry,
                  label: entry.id,
                  hint: reasons.get(entry.id),
                })),
              ],
            })
            if (canceled(skill)) return null
            if (skill === 'back') break
            console.log(`${skill.id} — ${reasons.get(skill.id)}`)
            console.log(stripVTControlCharacters(skill.description))
          }
        }
      }
    },
    reviewPermissions: async (packages, selection) => {
      const reviewableIds = new Set(
        selectedPermissionSkills(packages, {
          skills: selection.skills,
          exclude: [],
        }).map((skill) => skill.id.slice(0, skill.id.indexOf('#'))),
      )
      const reviewable = packages.filter((pkg) => reviewableIds.has(pkg.id))
      if (reviewable.length === 0) {
        console.log(
          'No enabled packages have selectable skills. Add packages or skills first; existing exclusions still apply.',
        )
        return selection
      }
      const packageIds = await runtime.autocompleteMultiselect({
        ...picker,
        message: 'Review individual skills — choose packages to review',
        placeholder: 'Leave empty to continue with all selected skills',
        options: reviewable.map((pkg) => ({ value: pkg.id, label: pkg.id })),
        initialValues: [],
        required: false,
      })
      if (canceled(packageIds)) return null
      if (packageIds.length === 0) return selection
      const selected = new Set(
        selectedPermissionSkills(packages, selection).map((skill) => skill.id),
      )
      const reviewedPackages = new Set(packageIds)
      for (const pkg of reviewable.filter((pkg) =>
        reviewedPackages.has(pkg.id),
      )) {
        const skills = await runtime.autocompleteMultiselect({
          ...picker,
          message: `Choose skills from ${pkg.id} — uncheck to exclude`,
          options: pkg.skills
            .filter((skill) => !skill.excluded)
            .map((skill) => ({
              value: skill.id,
              label: skill.name,
              hint: descriptionHint(skill.description),
            })),
          initialValues: pkg.skills
            .filter((skill) => selected.has(skill.id))
            .map((skill) => skill.id),
          required: false,
        })
        if (canceled(skills)) return null
        for (const skill of pkg.skills) selected.delete(skill.id)
        for (const skill of skills) selected.add(skill)
      }
      const broad = selection.skills.filter((skill) => !skill.includes('#'))
      const covered = new Set(
        selectedPermissionSkills(packages, { skills: broad, exclude: [] }).map(
          (skill) => skill.id,
        ),
      )
      const reviewedIds = new Set(
        packages
          .filter((pkg) => reviewedPackages.has(pkg.id))
          .flatMap((pkg) =>
            pkg.skills
              .filter((skill) => !skill.excluded)
              .map((skill) => skill.id),
          ),
      )
      const retainedIds = new Set<string>()
      const retainedRules = selection.skills.filter((rule) => {
        if (!rule.includes('#')) return true
        const config = parseSkillSources([rule])
        if (config.mode !== 'explicit') return true
        const source = config.sources[0]!
        if (source.kind === 'git' || 'pattern' in source) return true
        const id = `${source.kind === 'workspace' ? 'workspace:' : ''}${source.id}#${source.skill}`
        // Keep undiscovered and excluded rules, and preserve unchanged raw entries.
        if (reviewedIds.has(id) && !selected.has(id)) return false
        retainedIds.add(id)
        return true
      })
      const reviewedExcludes = new Set(
        [...reviewedIds].map((id) => id.replace(/^workspace:/, '')),
      )
      return {
        skills: [
          ...retainedRules,
          ...[...selected].filter(
            (id) =>
              reviewedIds.has(id) && !covered.has(id) && !retainedIds.has(id),
          ),
        ],
        // Exclusions are package-name based for both npm and workspace sources.
        exclude: [
          ...new Set([
            ...selection.exclude.filter((id) => !reviewedExcludes.has(id)),
            ...[...covered]
              .filter((id) => !selected.has(id))
              .map((id) => id.replace(/^workspace:/, '')),
          ]),
        ],
      }
    },
    confirmWrite: async (denyAll, review = false) => {
      const result = await runtime.select({
        ...picker,
        message: denyAll
          ? 'Disable all skills by writing intent.skills: []?'
          : 'Save these permissions?',
        initialValue: 'cancel',
        options: [
          {
            value: 'save',
            label: denyAll
              ? 'Disable all skills'
              : review
                ? 'Save permissions'
                : 'Continue with all selected skills',
          },
          ...(denyAll && !review
            ? []
            : [
                {
                  value: 'review',
                  label: review
                    ? 'Review permissions'
                    : 'Review individual skills',
                },
              ]),
          { value: 'cancel', label: 'Cancel' },
        ],
      })
      if (canceled(result)) return null
      return result === 'review' ? 'review' : result === 'save'
    },
  }
  return prompts
}
