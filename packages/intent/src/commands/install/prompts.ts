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
import { installTargetsForMethod } from './delivery.js'
import { skillSelectionId } from './plan.js'
import type { InstallConfirmation, InstallerPrompter } from './consumer.js'
import type { InstallMethod, InstallTarget } from './delivery.js'
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
      return cancelled(
        await select<InstallMethod>({
          message: 'How do you want to install skills?',
          options: [
            { value: 'symlink', label: 'Symlink skill folders' },
            { value: 'hooks', label: 'Install lifecycle hooks' },
          ],
        }),
      )
    },
    async selectTargets(
      method: InstallMethod,
      detected: ReadonlyArray<InstallTarget>,
    ): Promise<Array<InstallTarget> | null> {
      const targets = installTargetsForMethod(method)
      const supported = new Set(targets.map((target) => target.id))
      return cancelled(
        await multiselect<InstallTarget>({
          message: 'Where do you want to install skills?',
          options: targets.map((target) => ({
            value: target.id,
            label: target.label,
          })),
          initialValues: detected.filter((target) => supported.has(target)),
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
    async confirmUserScopeHooks(): Promise<boolean | null> {
      note(
        'GitHub Copilot hooks are stored in your home directory and affect Copilot sessions in this and other repositories.',
        'GitHub Copilot hooks apply across repositories',
      )
      return cancelled(
        await confirm({
          message:
            'Allow Intent to write GitHub Copilot hooks in your home directory?',
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
    async confirmInstall({
      delivery,
      skillCount,
    }): Promise<InstallConfirmation> {
      return cancelled(
        await select<Exclude<InstallConfirmation, null>>({
          message: `Install ${skillCount} ${skillCount === 1 ? 'skill' : 'skills'} using ${delivery.method}?`,
          options: [
            { value: 'install', label: 'Install' },
            { value: 'back', label: 'Go back' },
          ],
        }),
      )
    },
  }
}
