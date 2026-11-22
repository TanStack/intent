import { vi } from 'vitest'
import type {
  PermissionPackage,
  PermissionPrompts,
} from '../../src/commands/install/permissions.js'
import type { IntentPackage, ScanResult } from '../../src/shared/types.js'

export function permissionPrompts({
  confirmWrite = true,
  selection = [],
}: {
  confirmWrite?: boolean | null
  selection?: Array<string> | null
} = {}): PermissionPrompts & { groups: Array<PermissionPackage> } {
  const result = {
    groups: [] as Array<PermissionPackage>,
    selectPermissions: vi.fn(async (groups: Array<PermissionPackage>) => {
      result.groups = groups
      return selection
    }),
    reviewPermissions: vi.fn((_groups, selection) =>
      Promise.resolve(selection),
    ),
    editPermissions: vi.fn((_groups, selection) => Promise.resolve(selection)),
    confirmWrite: vi.fn(async () => confirmWrite),
  }
  return result
}

export function scanResult(packages: Array<IntentPackage>): ScanResult {
  return {
    packageManager: 'pnpm',
    packages,
    warnings: [],
    notices: [],
    conflicts: [],
    nodeModules: {
      local: {
        path: 'node_modules',
        detected: true,
        exists: true,
        scanned: true,
      },
      global: { path: null, detected: false, exists: false, scanned: false },
    },
    stats: { packageJsonCacheHits: 0, packageJsonReadCount: 0 },
  }
}
