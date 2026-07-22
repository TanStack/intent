import {
  cancel,
  confirm,
  groupMultiselect,
  intro,
  isCancel,
  multiselect,
  note,
  outro,
  select,
} from '@clack/prompts'
import { installTargetsForMethod } from './config.js'
import { skillSelectionId } from './plan.js'
import type { InstallConfirmation, InstallerPrompter } from './consumer.js'
import type { InstallMethod, InstallTarget } from './config.js'
import type { SkillSelection } from './plan.js'
import type { IntentPackage } from '../../shared/types.js'

function cancelled<T>(value: T | symbol): T | null {
  if (!isCancel(value)) return value
  cancel('Installation cancelled.')
  return null
}

function sourceLabel(pkg: IntentPackage): string {
  return pkg.kind === 'workspace' ? `workspace:${pkg.name}` : pkg.name
}

export function groupSkillOptions(
  discovered: ReadonlyArray<IntentPackage>,
): Record<
  string,
  Array<{ value: string; label: string; hint: string | undefined }>
> {
  return Object.fromEntries(
    discovered.map((pkg) => [
      sourceLabel(pkg),
      pkg.skills.map((skill) => ({
        value: skillSelectionId(pkg, skill),
        label: skill.name,
        hint: skill.description || undefined,
      })),
    ]),
  )
}

export async function selectClackSkills(
  discovered: ReadonlyArray<IntentPackage>,
  includeModes = true,
): Promise<SkillSelection | null> {
  note(
    `${discovered.reduce((count, pkg) => count + pkg.skills.length, 0)} skills from ${discovered.length} packages`,
    'Skills found',
  )
  if (includeModes) {
    const mode = cancelled(
      await select<SkillSelection['mode']>({
        message: 'Which skills do you want to enable?',
        options: [
          { value: 'all-found', label: 'Enable all skills found' },
          { value: 'scope', label: 'Enable all @tanstack/* skills' },
          { value: 'individual', label: 'Select skills' },
        ],
      }),
    )
    if (!mode) return null
    if (mode === 'all-found') return { mode }
    if (mode === 'scope') return { mode, scope: '@tanstack/*' }
  }
  const enabled = cancelled(
    await groupMultiselect<string>({
      message: 'Select skills to enable',
      options: groupSkillOptions(discovered),
      required: false,
      selectableGroups: true,
      groupSpacing: 1,
    }),
  )
  return enabled ? { mode: 'individual', enabled } : null
}

export function createClackInstallerPrompter(): InstallerPrompter {
  intro('Configure TanStack Intent')
  return {
    complete(message: string): void {
      outro(message)
    },
    async selectMethod(): Promise<InstallMethod | null> {
      for (;;) {
        const method = cancelled(
          await select<InstallMethod>({
            message: 'How do you want to install skills?',
            options: [
              { value: 'symlink', label: 'Symlink skill folders' },
              { value: 'hooks', label: 'Install lifecycle hooks' },
              {
                value: 'map',
                label: 'Add a compact skill map to agent instructions',
              },
            ],
          }),
        )
        if (!method || method === 'symlink') return method
        note(
          'This delivery adapter is not available in the current installer slice.',
          method === 'hooks'
            ? 'Lifecycle hooks are coming next'
            : 'Compact skill maps are coming next',
        )
      }
    },
    async selectTargets(
      method: InstallMethod,
    ): Promise<Array<InstallTarget> | null> {
      return cancelled(
        await multiselect<InstallTarget>({
          message: 'Where do you want to install skills?',
          options: installTargetsForMethod(method).map((target) => ({
            value: target.id,
            label: target.label,
          })),
          required: true,
        }),
      )
    },
    async confirmSymlink(): Promise<boolean | null> {
      note(
        'Package updates may change linked skills before Intent verifies intent.lock. Intent detects drift when it runs again, but it cannot prevent an agent from reading changed content before that check.',
        'Symlinks expose live package skill content',
      )
      return cancelled(
        await confirm({
          message: 'Continue with symlinks?',
          initialValue: false,
          vertical: true,
        }),
      )
    },
    async selectSkills(
      discovered: ReadonlyArray<IntentPackage>,
    ): Promise<SkillSelection | null> {
      return selectClackSkills(discovered)
    },
    async confirmInstall({ config, skillCount }): Promise<InstallConfirmation> {
      return cancelled(
        await select<Exclude<InstallConfirmation, null>>({
          message: `Install ${skillCount} ${skillCount === 1 ? 'skill' : 'skills'} using ${config.install.method}?`,
          options: [
            { value: 'install', label: 'Install' },
            { value: 'back', label: 'Go back' },
          ],
        }),
      )
    },
  }
}
