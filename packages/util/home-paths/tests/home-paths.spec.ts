import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AGENTS_HOME_DIR_NAME,
  DEFAULT_AGENTS_HOME_DISPLAY,
  DEFAULT_TBM_ENGINE_HOME_DISPLAY,
  TBM_ENGINE_HOME_DIR_NAME,
  agentsHomeDisplay,
  canonicalizeWatchPath,
  defaultAgentsHome,
  defaultTbmHome,
  tbmCachePath,
  tbmHomeDisplay,
  tbmHomePath,
  expandHomePath,
  resolveAgentsHome,
  resolveTbmHome,
} from '@tbm-insight/home-paths'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('tbm path helpers', () => {
  it('owns the shared default TBM_ENGINE home directory name', () => {
    expect(TBM_ENGINE_HOME_DIR_NAME).toBe('.tbm')
    expect(DEFAULT_TBM_ENGINE_HOME_DISPLAY).toBe('~/.tbm')
    expect(defaultTbmHome()).toBe(join(homedir(), '.tbm'))
  })

  it('expands tilde paths without changing non-tilde paths', () => {
    expect(expandHomePath('~')).toBe(homedir())
    expect(expandHomePath('~/.tbm')).toBe(join(homedir(), '.tbm'))
    expect(expandHomePath('~\\.tbm')).toBe(join(homedir(), '.tbm'))
    expect(expandHomePath('/tmp/.tbm')).toBe('/tmp/.tbm')
    expect(expandHomePath('~other/.tbm')).toBe('~other/.tbm')
  })

  it('resolves explicit path before TBM_ENGINE_HOME and the default', () => {
    const envHome = join(homedir(), 'env-tbm')

    expect(resolveTbmHome('/tmp/explicit-tbm', { TBM_ENGINE_HOME: '~/env-tbm' })).toBe(resolve('/tmp/explicit-tbm'))
    expect(resolveTbmHome(undefined, { TBM_ENGINE_HOME: '~/env-tbm' })).toBe(envHome)
    expect(resolveTbmHome(undefined, {})).toBe(defaultTbmHome())
  })

  it('treats an empty or whitespace-only TBM_ENGINE_HOME as unset', () => {
    expect(resolveTbmHome(undefined, { TBM_ENGINE_HOME: '' })).toBe(defaultTbmHome())
    expect(resolveTbmHome(undefined, { TBM_ENGINE_HOME: '   ' })).toBe(defaultTbmHome())
  })

  it('joins child segments onto the resolved TBM_ENGINE_HOME', () => {
    vi.stubEnv('TBM_ENGINE_HOME', '~/env-tbm')
    expect(tbmHomePath()).toBe(join(homedir(), 'env-tbm'))
    expect(tbmHomePath('storages', 'cache')).toBe(join(homedir(), 'env-tbm', 'storages', 'cache'))
  })

  it('labels a resolved home by whether it is the default root', () => {
    expect(tbmHomeDisplay(resolve(defaultTbmHome()))).toBe('~/.tbm')
    expect(tbmHomeDisplay('/some/other/root')).toBe('$TBM_ENGINE_HOME')
  })

  it('owns the shared default agents home directory name', () => {
    expect(AGENTS_HOME_DIR_NAME).toBe('.agents')
    expect(DEFAULT_AGENTS_HOME_DISPLAY).toBe('~/.agents')
    expect(defaultAgentsHome()).toBe(join(homedir(), '.agents'))
  })

  it('resolves an explicit agents home before TBM_ENGINE_AGENTS_HOME and the default', () => {
    const envHome = join(homedir(), 'env-agents')

    expect(resolveAgentsHome('/tmp/explicit-agents', { TBM_ENGINE_AGENTS_HOME: '~/env-agents' })).toBe(resolve('/tmp/explicit-agents'))
    expect(resolveAgentsHome(undefined, { TBM_ENGINE_AGENTS_HOME: '~/env-agents' })).toBe(envHome)
    expect(resolveAgentsHome(undefined, {})).toBe(defaultAgentsHome())
  })

  it('treats an empty or whitespace-only TBM_ENGINE_AGENTS_HOME as unset', () => {
    expect(resolveAgentsHome(undefined, { TBM_ENGINE_AGENTS_HOME: '' })).toBe(defaultAgentsHome())
    expect(resolveAgentsHome(undefined, { TBM_ENGINE_AGENTS_HOME: '   ' })).toBe(defaultAgentsHome())
  })

  it('labels a resolved agents home by whether it is the default root', () => {
    expect(agentsHomeDisplay(resolve(defaultAgentsHome()))).toBe('~/.agents')
    expect(agentsHomeDisplay('/some/other/root')).toBe('$TBM_ENGINE_AGENTS_HOME')
  })

  it.each([
    [undefined, join(homedir(), '.tbm')],
    ['', join(homedir(), '.tbm')],
    ['   ', join(homedir(), '.tbm')],
    ['~/env-tbm', join(homedir(), 'env-tbm')],
    ['./relative-tbm', resolve('./relative-tbm')],
  ] as const)('resolves cache paths with TBM_ENGINE_HOME=%j', (home, expectedHome) => {
    vi.stubEnv('TBM_ENGINE_HOME', home)
    try {
      expect(tbmCachePath()).toBe(join(expectedHome, 'cache'))
      expect(tbmCachePath('models', 'index.json')).toBe(join(expectedHome, 'cache', 'models', 'index.json'))
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('resolves configured cache homes before the environment', () => {
    vi.stubEnv('TBM_ENGINE_HOME', '~/env-tbm')
    try {
      expect(tbmCachePath({ tbmHome: '~/explicit-tbm' })).toBe(join(homedir(), 'explicit-tbm', 'cache'))
      expect(tbmCachePath({ tbmHome: './explicit-tbm' }, 'attachments', 'request-images'))
        .toBe(resolve('./explicit-tbm/cache/attachments/request-images'))
      expect(tbmCachePath({}, 'attachments')).toBe(join(homedir(), 'env-tbm', 'cache', 'attachments'))
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it('canonicalizes a watcher ancestor while preserving a missing suffix', async () => {
    const root = await mkdtemp(join(tmpdir(), 'tbm-watch-path-'))
    const target = join(root, 'target')
    const alias = join(root, 'alias')
    try {
      await mkdir(target)
      await symlink(target, alias, process.platform === 'win32' ? 'junction' : 'dir')
      await expect(canonicalizeWatchPath(alias)).resolves.toBe(await realpath(target))
      await expect(canonicalizeWatchPath(join(alias, 'later', 'config.yml'))).resolves.toBe(
        join(await realpath(target), 'later', 'config.yml'),
      )
      const file = join(root, 'file')
      await writeFile(file, 'not a directory')
      await expect(canonicalizeWatchPath(join(file, 'child'))).rejects.toMatchObject({ code: 'ENOTDIR' })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
