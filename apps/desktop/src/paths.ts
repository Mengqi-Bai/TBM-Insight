/** Filesystem ownership for the Electron-managed desktop installation. */

import { join } from 'node:path'
import { resolveTbmHome } from '@tbm-insight/home-paths'

/** Stable desktop installation paths under the shared Harness home. */
export interface DesktopPaths {
  readonly profile: string
  readonly lock: string
}

/**
 * Resolve every Electron-owned path without changing the shared data roots.
 * @param tbmHome - Harness home shared with npm-installed tbm.
 * @returns immutable desktop path set.
 */
export function resolveDesktopPaths(tbmHome: string = resolveTbmHome()): DesktopPaths {
  return {
    profile: join(tbmHome, 'profiles', 'desktop'),
    lock: join(tbmHome, 'profiles', 'desktop', 'lock'),
  }
}
