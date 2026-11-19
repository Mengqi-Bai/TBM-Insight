import { describe, expect, it } from 'vitest'
import type { NpmPackageLock, RegistryIndex } from './benchmark-npm-resolution.ts'
import {
  assertDualTbmInstallLayout,
  assertResolutionWorkBudget,
  buildDualTbmRegistry,
  MAX_RESOLUTION_WORK_UNITS,
} from './verify-npm-install-layout.ts'

function validLayout(): NpmPackageLock {
  return {
    lockfileVersion: 3,
    packages: {
      '': { dependencies: { '@tbm-insight/cli': '0.2.0', 'tbm-previous': 'npm:@tbm-insight/cli@0.1.0' } },
      'node_modules/@tbm-insight/cordis': { version: '4.0.1' },
      'node_modules/@tbm-insight/cli': {
        version: '0.2.0',
        dependencies: { '@tbm-insight/child': '^0.2.0' },
        peerDependencies: { '@tbm-insight/cordis': '^4.0.1' },
      },
      'node_modules/@tbm-insight/child': {
        version: '0.2.0',
        dependencies: { '@tbm-insight/leaf': '^0.2.0' },
      },
      'node_modules/@tbm-insight/leaf': { version: '0.2.0' },
      'node_modules/tbm-previous': {
        name: '@tbm-insight/cli',
        version: '0.1.0',
        dependencies: { '@tbm-insight/child': '^0.1.0' },
        peerDependencies: { '@tbm-insight/cordis': '^4.0.1' },
      },
      'node_modules/tbm-previous/node_modules/@tbm-insight/child': {
        version: '0.1.0',
        dependencies: { '@tbm-insight/leaf': '^0.1.0' },
      },
      'node_modules/tbm-previous/node_modules/@tbm-insight/leaf': { version: '0.1.0' },
    },
  }
}

describe('npm install layout verifier', () => {
  it('creates two incompatible versions of every TBM_ENGINE package', () => {
    const index: RegistryIndex = new Map([
      ['@tbm-insight/cli', new Map([['0.1.1-rc.2', {
        name: '@tbm-insight/cli',
        version: '0.1.1-rc.2',
        dependencies: { '@tbm-insight/child': '^0.1.1-rc.2' },
        peerDependencies: { '@tbm-insight/cordis': '^4.0.1' },
      }]])],
      ['@tbm-insight/child', new Map([['0.1.1-rc.2', {
        name: '@tbm-insight/child',
        version: '0.1.1-rc.2',
      }]])],
      ['@tbm-insight/cordis', new Map([['4.0.1', {
        name: '@tbm-insight/cordis',
        version: '4.0.1',
      }]])],
    ])

    const dual = buildDualTbmRegistry(index, '0.1.1-rc.2')

    expect([...dual.get('@tbm-insight/cli')?.keys() ?? []]).toEqual(['0.1.0', '0.2.0'])
    expect(dual.get('@tbm-insight/cli')?.get('0.1.0')).toMatchObject({
      version: '0.1.0',
      dependencies: { '@tbm-insight/child': '^0.1.0' },
      peerDependencies: { '@tbm-insight/cordis': '^4.0.1' },
    })
    expect(dual.get('@tbm-insight/cli')?.get('0.2.0')).toMatchObject({
      version: '0.2.0',
      dependencies: { '@tbm-insight/child': '^0.2.0' },
    })
    expect(dual.get('@tbm-insight/cordis')).toBe(index.get('@tbm-insight/cordis'))
  })

  it('accepts isolated TBM_ENGINE releases with one shared Cordis installation', () => {
    expect(assertDualTbmInstallLayout(validLayout())).toEqual({
      tbmPackagesPerVersion: 3,
      checkedTbmEdges: 4,
    })
  })

  it.each([
    ['react', 'node_modules/react'],
    ['react-dom', 'node_modules/react-dom'],
    ['react', 'node_modules/tbm-previous/node_modules/react'],
    ['react-dom', 'node_modules/tbm-previous/node_modules/react-dom'],
  ])('rejects browser runtime %s installed at %s in the TBM_ENGINE-only consumer', (name, path) => {
    const layout = validLayout()
    const packages = { ...layout.packages, [path]: { version: '18.3.1' } }
    expect(() => assertDualTbmInstallLayout({ ...layout, packages })).toThrow(
      `${path}: ${name} is a browser build input`,
    )
  })

  it('rejects an internal edge that crosses release versions', () => {
    const layout = validLayout()
    const packages = { ...layout.packages }
    Reflect.deleteProperty(packages, 'node_modules/tbm-previous/node_modules/@tbm-insight/leaf')

    expect(() => assertDualTbmInstallLayout({ ...layout, packages })).toThrow(
      'node_modules/tbm-previous/node_modules/@tbm-insight/child: dependencies '
      + '@tbm-insight/leaf resolves to node_modules/@tbm-insight/leaf@0.2.0, expected 0.1.0',
    )
  })

  it('rejects a second Cordis installation', () => {
    const layout = validLayout()
    const packages = {
      ...layout.packages,
      'node_modules/tbm-previous/node_modules/@tbm-insight/cordis': { version: '4.0.1' },
    }

    expect(() => assertDualTbmInstallLayout({ ...layout, packages })).toThrow(
      'expected one shared @tbm-insight/cordis',
    )
  })
})

describe('resolution work budget', () => {
  it.each([
    [277, 2524, 699_148],
    [316, 2780, 878_480],
    [316, 2786, 880_376],
    [317, 2786, 883_162],
    [320, 2836, 907_520],
  ])('accepts the measured dual-release graph with %i packages and %i edges', (packages, edges, units) => {
    expect(assertResolutionWorkBudget({ tbmPackagesPerVersion: packages, checkedTbmEdges: edges }))
      .toBe(units)
  })

  it('accepts a graph exactly at the budget and rejects one internal edge above it', () => {
    const packages = 320
    const edgesAtBudget = Math.floor(MAX_RESOLUTION_WORK_UNITS / packages)

    expect(packages * edgesAtBudget).toBe(MAX_RESOLUTION_WORK_UNITS)
    expect(assertResolutionWorkBudget({ tbmPackagesPerVersion: packages, checkedTbmEdges: edgesAtBudget }))
      .toBe(MAX_RESOLUTION_WORK_UNITS)
    expect(() => assertResolutionWorkBudget({
      tbmPackagesPerVersion: packages,
      checkedTbmEdges: edgesAtBudget + 1,
    })).toThrow(`= ${String(MAX_RESOLUTION_WORK_UNITS + packages)} unit(s), budget ${String(MAX_RESOLUTION_WORK_UNITS)} unit(s)`)
  })

  it('accepts the headroom and rejects a runaway graph with its own measured counts', () => {
    expect(assertResolutionWorkBudget({ tbmPackagesPerVersion: 350, checkedTbmEdges: 3200 }))
      .toBe(1_120_000)
    expect(() => assertResolutionWorkBudget({ tbmPackagesPerVersion: 400, checkedTbmEdges: 3000 }))
      .toThrow(`400 package(s) per release x 3000 internal edge(s) = 1200000 unit(s), budget ${String(MAX_RESOLUTION_WORK_UNITS)} unit(s)`)
  })
})
