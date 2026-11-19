/** Release family discovery, publish order, tag naming, and the bump judgements. */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { officialClientBuildEnvironment, writeClientBuildRecord } from '../client-build-environment.ts'
import { ON_DEMAND_BUNDLES } from '../../packages/util/official-bundles/src/bundles.ts'
import { releaseFamily, type ReleaseMember } from './families.ts'
import { compareVersions, nextVendorVersion, planShared, reachesPayload } from './bump.ts'

/**
 * A release member standing in for a manifest on disk.
 * @param directory - repository-relative package directory.
 * @param name - package name.
 * @param manifest - manifest fields the subject reads.
 * @returns The member.
 */
function member(directory: string, name: string, manifest: Record<string, unknown> = {}): ReleaseMember {
  return { directory, name, version: '0.0.1', manifest }
}

const roots: string[] = []

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function buildFixture(environment: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'tbm-release-build-'))
  roots.push(root)
  write(join(root, 'package.json'), `${JSON.stringify({ version: environment.TBM_ENGINE_CLIENT_VERSION ?? '0.0.1' })}\n`)
  write(join(root, 'apps/web/dist/index.html'), '<main></main>')
  write(join(root, 'packages/client/example/lib/client.js'), 'module.exports = {}\n')
  writeClientBuildRecord(root, environment)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  vi.unstubAllEnvs()
})

describe('release families', () => {
  it('publishes all current experimental packages', () => {
    const members = releaseFamily('tbm').members(resolve(import.meta.dirname, '../..'))

    expect(members
      .filter(member => member.directory.startsWith('packages/experimental/'))
      .map(member => member.name)).toEqual([
      '@tbm-insight/action-cards',
      '@tbm-insight/experimental-api-speech-to-text',
      '@tbm-insight/experimental-auto-review',
      '@tbm-insight/experimental-badge-skill-bundle',
      '@tbm-insight/experimental-browser-use-chrome-devtools-mcp',
      '@tbm-insight/experimental-browser-use-playwright-mcp',
      '@tbm-insight/experimental-browser-use-runtime',
      '@tbm-insight/experimental-browser-use-stagehand-native',
      '@tbm-insight/experimental-claude-code-mods',
      '@tbm-insight/client-ui-action-cards',
      '@tbm-insight/experimental-client-ui-claude-code-mods',
      '@tbm-insight/experimental-client-ui-cot-translation',
      '@tbm-insight/client-ui-creation-recommendations',
      '@tbm-insight/experimental-client-ui-forge',
      '@tbm-insight/client-ui-plugin-recommendations',
      '@tbm-insight/experimental-client-ui-stats',
      '@tbm-insight/experimental-client-ui-voice-input',
      '@tbm-insight/experimental-computer-use-cua-driver-mcp',
      '@tbm-insight/experimental-computer-use-cua-driver-native',
      '@tbm-insight/experimental-cot-translation-bundle',
      '@tbm-insight/creation-recommendations',
      '@tbm-insight/cua-bundle',
      '@tbm-insight/experimental-cua-macos',
      '@tbm-insight/cua',
      '@tbm-insight/experimental-forge-bundle',
      '@tbm-insight/experimental-forge-github',
      '@tbm-insight/experimental-forge-session',
      '@tbm-insight/experimental-forge',
      '@tbm-insight/hook-protocol',
      '@tbm-insight/hooks-claude-code',
      '@tbm-insight/hooks-codex',
      '@tbm-insight/experimental-inspector-profile',
      '@tbm-insight/experimental-inspector',
      '@tbm-insight/experimental-liveshare-protocol',
      '@tbm-insight/experimental-liveshare',
      '@tbm-insight/personalized-recommendations',
      '@tbm-insight/experimental-plugin-market-bundle',
      '@tbm-insight/plugin-recommendations',
      '@tbm-insight/experimental-ptc-runtime-python',
      '@tbm-insight/experimental-ralph-bundle',
      '@tbm-insight/experimental-session-inspector',
      '@tbm-insight/experimental-session-search',
      '@tbm-insight/session-title-all-prompts-llm',
      '@tbm-insight/experimental-session-titles-bundle',
      '@tbm-insight/skill-badge',
      '@tbm-insight/experimental-speech-to-text-sensevoice',
      '@tbm-insight/experimental-speech-to-text',
      '@tbm-insight/experimental-subagent-oar',
      '@tbm-insight/experimental-terminal-bundle',
      '@tbm-insight/tool-ralph',
      '@tbm-insight/tool-session-query',
      '@tbm-insight/experimental-tool-subagent-oar',
      '@tbm-insight/tool-terminal',
      '@tbm-insight/experimental-tool-worktree',
      '@tbm-insight/experimental-translator',
      '@tbm-insight/experimental-voice-input-bundle',
      '@tbm-insight/webhook-github',
      '@tbm-insight/webhook',
      '@tbm-insight/experimental-webworker-packer',
      '@tbm-insight/experimental-webworker-runtime',
      '@tbm-insight/experimental-worktree',
    ])
  })

  it('excludes private applications from the publish set', () => {
    const root = mkdtempSync(join(tmpdir(), 'tbm-release-private-'))
    roots.push(root)
    write(join(root, 'apps/public/package.json'), '{"name":"@tbm-insight/public","version":"0.0.1"}\n')
    write(join(root, 'apps/private/package.json'), '{"name":"@tbm-insight/private","version":"0.0.1","private":true}\n')

    expect(releaseFamily('tbm').members(root).map(entry => entry.name)).toEqual(['@tbm-insight/public'])
  })

  it('publishes unlisted experimental packages while retaining private exclusions', () => {
    const root = mkdtempSync(join(tmpdir(), 'tbm-release-experimental-'))
    roots.push(root)
    write(join(root, 'packages/experimental/prototype/package.json'), JSON.stringify({
      name: '@tbm-insight/experimental-prototype',
      version: '0.0.1',
      publishConfig: { access: 'public' },
    }))
    write(join(root, 'packages/experimental/inspector/package.json'), JSON.stringify({
      name: '@tbm-insight/experimental-inspector',
      version: '0.0.1',
      private: true,
    }))

    expect(releaseFamily('tbm').members(root).map(entry => entry.name)).toEqual([
      '@tbm-insight/experimental-prototype',
    ])
  })

  it('bumps private tbm workspaces without adding release tags', () => {
    const root = mkdtempSync(join(tmpdir(), 'tbm-release-version-'))
    roots.push(root)
    write(join(root, 'package.json'), '{"version":"0.0.1"}\n')
    write(join(root, 'apps/desktop/package.json'), '{"version":"0.0.1","private":true}\n')
    write(join(root, 'packages/experimental/prototype/package.json'), '{"version":"0.0.1","private":true}\n')
    write(join(root, 'packages/core/unselected/package.json'), '{"version":"0.0.1"}\n')

    const tbm = releaseFamily('tbm')
    const published = member('packages/core/published', '@tbm-insight/published')
    const { planned } = planShared(tbm, root, [published], '0.0.2')

    expect(planned.map(entry => ({ path: entry.manifestPath, tag: entry.tag }))).toEqual([
      { path: 'package.json', tag: undefined },
      { path: 'packages/core/published/package.json', tag: 'tbm-v0.0.2' },
      { path: 'apps/desktop/package.json', tag: undefined },
      { path: 'packages/experimental/prototype/package.json', tag: undefined },
    ])
  })

  it.each(['0.0.2-alpha.1', '0.0.2-canary.1', '0.0.2-rc.1'])(
    'accepts the explicit tbm prerelease version %s',
    (version) => {
      const root = mkdtempSync(join(tmpdir(), 'tbm-release-prerelease-'))
      roots.push(root)
      write(join(root, 'package.json'), '{"version":"0.0.1"}\n')

      const tbm = releaseFamily('tbm')
      const published = member('packages/core/published', '@tbm-insight/published')
      const plan = planShared(tbm, root, [published], version)

      expect(plan.version).toBe(version)
      expect(plan.planned[1]?.tag).toBe(`tbm-v${version}`)
    },
  )

  it('names one tag for the whole tbm family and one per vendored package', () => {
    const tbm = releaseFamily('tbm')
    const vendor = releaseFamily('vendor')
    const cli = member('apps/cli', '@tbm-insight/cli')
    const cordis = { ...member('vendor/cordis', '@tbm-insight/cordis'), version: '4.0.1' }

    expect(tbm.tagFor(cli)).toBe('tbm-v0.0.1')
    expect(vendor.tagFor(cordis)).toBe('vendor-cordis-v4.0.1')
    // The prefix is constructed, not recovered from a tag: a version with a
    // hyphen would defeat any suffix-stripping.
    expect(vendor.tagPrefixFor({ ...cordis, version: '4.0.0-rc.7' })).toBe('vendor-cordis-v')
    expect(vendor.tagFor({ ...cordis, version: '4.0.0-rc.7' })).toBe('vendor-cordis-v4.0.0-rc.7')
  })

  it('assigns alpha and canary dist-tags only to tbm releases', () => {
    const tbm = releaseFamily('tbm')
    const vendor = releaseFamily('vendor')

    expect(tbm.distTagForVersion('0.0.2-alpha.1')).toBe('alpha')
    expect(tbm.distTagForVersion('0.0.2-canary.1')).toBe('canary')
    expect(tbm.distTagForVersion('0.0.2-rc.1')).toBe('next')
    expect(tbm.distTagForVersion('0.0.2')).toBeUndefined()
    expect(vendor.distTagForVersion('4.0.1-alpha.1')).toBe('next')
    expect(vendor.distTagForVersion('4.0.1-canary.1')).toBe('next')
  })

  it('rejects a family whose members disagree on the shared version', () => {
    const tbm = releaseFamily('tbm')
    const members = [member('apps/cli', '@tbm-insight/cli'), { ...member('apps/web', '@tbm-insight/web-frontend'), version: '0.0.2' }]

    expect(() => { tbm.verifyVersions(members) }).toThrow(/must share one version/)
    expect(() => { tbm.verifyVersions([members[0]!]) }).not.toThrow()
  })

  it('accepts independent vendored versions and rejects an unpublishable one', () => {
    const vendor = releaseFamily('vendor')
    const members = [
      { ...member('vendor/cordis', '@tbm-insight/cordis'), version: '4.0.1' },
      { ...member('vendor/cosmokit', '@tbm-insight/cosmokit'), version: '1.8.2' },
    ]

    expect(() => { vendor.verifyVersions(members) }).not.toThrow()
    expect(() => { vendor.verifyVersions([{ ...members[0]!, version: 'latest' }]) }).toThrow(/unpublishable version/)
  })

  it('requires a current official client build only for tbm artifacts', () => {
    const tbm = releaseFamily('tbm')
    const vendor = releaseFamily('vendor')
    const officialEnvironment = officialClientBuildEnvironment(resolve(import.meta.dirname, '../..'))
    vi.stubEnv('TBM_ENGINE_CLIENT_COMMIT_HASH', officialEnvironment.TBM_ENGINE_CLIENT_COMMIT_HASH)
    const official = buildFixture(officialEnvironment)
    const defaultBuild = buildFixture({})
    const missing = join(defaultBuild, 'missing')
    write(join(missing, 'package.json'), `${JSON.stringify({ version: officialEnvironment.TBM_ENGINE_CLIENT_VERSION })}\n`)

    expect(() => { tbm.verifyBuildArtifacts(official) }).not.toThrow()
    expect(() => { tbm.verifyBuildArtifacts(defaultBuild) }).toThrow(/TBM_ENGINE_CLIENT_TITLE/)
    expect(() => { tbm.verifyBuildArtifacts(missing) }).toThrow(/record.*missing/)
    expect(() => { vendor.verifyBuildArtifacts(missing) }).not.toThrow()

    write(join(official, 'packages/client/example/lib/client.js'), 'module.exports = { changed: true }\n')
    expect(() => { tbm.verifyBuildArtifacts(official) }).toThrow(/artifacts differ/)
  })

  it('publishes a dependency before its consumer, and orders ties by name', () => {
    const tbm = releaseFamily('tbm')
    const members = [
      member('packages/a/consumer', '@tbm-insight/consumer', { dependencies: { '@tbm-insight/library': 'workspace:^' } }),
      member('packages/a/library', '@tbm-insight/library'),
      member('packages/a/zebra', '@tbm-insight/zebra'),
    ]

    expect(tbm.publishOrder(members).order.map(entry => entry.name)).toEqual([
      '@tbm-insight/library',
      '@tbm-insight/consumer',
      '@tbm-insight/zebra',
    ])
  })

  it('publishes on-demand catalog members before tbm without adding installed dependencies', () => {
    const tbm = member('apps/cli', '@tbm-insight/cli')
    const providers = ON_DEMAND_BUNDLES.map(name => member(`packages/subagent/${name}`, name))
    const plan = releaseFamily('tbm').publishOrder([tbm, ...providers])
    expect(plan.order.map(entry => entry.name)).toEqual([...ON_DEMAND_BUNDLES.toSorted(), tbm.name])
    expect(tbm.manifest).toEqual({})
    expect(plan.droppedPeerEdges).toEqual([])
  })

  it('rejects an advertised provider missing from the public release family', () => {
    expect(() => releaseFamily('tbm').publishOrder([member('apps/cli', '@tbm-insight/cli')]))
      .toThrow('Official catalog prerequisite')
  })

  it('keeps catalog prerequisites ahead of a tbm peer declaration', () => {
    const tbm = member('apps/cli', '@tbm-insight/cli')
    const providers = ON_DEMAND_BUNDLES.map(name => member(`packages/subagent/${name}`, name, {
      peerDependencies: { '@tbm-insight/cli': 'workspace:*' },
    }))
    const plan = releaseFamily('tbm').publishOrder([tbm, ...providers])
    expect(plan.order.map(entry => entry.name)).toEqual([...ON_DEMAND_BUNDLES.toSorted(), tbm.name])
    expect(plan.droppedPeerEdges).toEqual(ON_DEMAND_BUNDLES.toSorted().map(name => ({ consumer: name, peer: tbm.name })))
  })

  it.each(['dependencies', 'optionalDependencies', 'peerDependencies'])(
    'requires exact packed TBM_ENGINE %s while preserving external ranges', (section) => {
      const pkg = member('packages/example/provider', '@tbm-insight/provider')
      const family = releaseFamily('tbm')
      const manifest = { name: pkg.name, version: pkg.version, [section]: { '@tbm-insight/tools': pkg.version, external: '^4.0.0' } }
      expect(() => { family.validatePackedManifest(pkg, manifest) }).not.toThrow()
      for (const range of ['workspace:*', '^0.0.1', '~0.0.1', '0.0.2', '*']) {
        expect(() => { family.validatePackedManifest(pkg, { ...manifest, [section]: { '@tbm-insight/tools': range } }) })
          .toThrow(`packed ${section}.@tbm-insight/tools must equal`)
      }
    },
  )

  it('checks packed identities and preserves independent vendor versions', () => {
    const pkg = member('vendor/example', '@deepseek-ai/example')
    const family = releaseFamily('vendor')
    expect(() => { family.validatePackedManifest(pkg, { name: pkg.name, version: pkg.version, dependencies: { '@tbm-insight/tools': '^4.0.0' } }) })
      .not.toThrow()
    expect(() => { family.validatePackedManifest(pkg, { name: '@deepseek-ai/other', version: pkg.version }) }).toThrow('packed identity')
    expect(() => { family.validatePackedManifest(pkg, { name: pkg.name, version: '0.0.2' }) }).toThrow('packed identity')
  })

  it('reports a runtime dependency cycle instead of emitting an arbitrary order', () => {
    const tbm = releaseFamily('tbm')
    const members = [
      member('packages/a/left', '@tbm-insight/left', { dependencies: { '@tbm-insight/right': 'workspace:^' } }),
      member('packages/a/right', '@tbm-insight/right', { dependencies: { '@tbm-insight/left': 'workspace:^' } }),
    ]

    expect(() => { tbm.publishOrder(members) }).toThrow(/dependency cycle/)
  })

  it('publishes a peer before its consumer', () => {
    const tbm = releaseFamily('tbm')
    const members = [
      member('packages/a/consumer', '@tbm-insight/consumer', { peerDependencies: { '@tbm-insight/zebra': 'workspace:^' } }),
      member('packages/a/zebra', '@tbm-insight/zebra'),
    ]

    // Name order alone would place the consumer first; the peer edge moves it.
    expect(tbm.publishOrder(members).order.map(entry => entry.name)).toEqual([
      '@tbm-insight/zebra',
      '@tbm-insight/consumer',
    ])
  })

  it('orders around a peer cycle rather than refusing to publish, and reports the edge it dropped', () => {
    const tbm = releaseFamily('tbm')
    const members = [
      member('packages/a/left', '@tbm-insight/left', { peerDependencies: { '@tbm-insight/right': 'workspace:^' } }),
      member('packages/a/right', '@tbm-insight/right', { peerDependencies: { '@tbm-insight/left': 'workspace:^' } }),
    ]

    // Sibling packages declare each other as peers, and npm treats an unmet peer
    // as a warning, so this pair has to publish rather than fail the release.
    const plan = tbm.publishOrder(members)
    expect(plan.order.map(entry => entry.name)).toEqual([
      '@tbm-insight/right',
      '@tbm-insight/left',
    ])
    // One of the two edges has to give, and which one it is belongs in the log.
    expect(plan.droppedPeerEdges).toEqual([
      { consumer: '@tbm-insight/right', peer: '@tbm-insight/left' },
    ])
  })

  it('honours an install edge even when a peer cycle surrounds it', () => {
    const tbm = releaseFamily('tbm')
    const members = [
      member('packages/a/base', '@tbm-insight/base', { peerDependencies: { '@tbm-insight/consumer': 'workspace:^' } }),
      member('packages/a/consumer', '@tbm-insight/consumer', {
        dependencies: { '@tbm-insight/base': 'workspace:^' },
        peerDependencies: { '@tbm-insight/base': 'workspace:^' },
      }),
    ]

    // The install edge is absolute: base publishes first, and the peer edge that
    // would reverse it is the one dropped.
    const plan = tbm.publishOrder(members)
    expect(plan.order.map(entry => entry.name)).toEqual([
      '@tbm-insight/base',
      '@tbm-insight/consumer',
    ])
    expect(plan.droppedPeerEdges).toEqual([
      { consumer: '@tbm-insight/base', peer: '@tbm-insight/consumer' },
    ])
  })

  it('refuses an order that would publish a consumer before a dependency it installs', () => {
    const tbm = releaseFamily('tbm')
    const members = [
      member('packages/a/alpha', '@tbm-insight/alpha', { peerDependencies: { '@tbm-insight/bravo': 'workspace:^' } }),
      member('packages/a/bravo', '@tbm-insight/bravo', { peerDependencies: { '@tbm-insight/charlie': 'workspace:^' } }),
      member('packages/a/charlie', '@tbm-insight/charlie', { dependencies: { '@tbm-insight/alpha': 'workspace:^' } }),
    ]

    // A cycle of two peer edges closed by one install edge: dropping a peer edge
    // would order this, and the traversal drops the install edge instead. That
    // order would publish charlie before the alpha it installs, so it is refused
    // here rather than published.
    expect(() => { tbm.publishOrder(members) }).toThrow(/no publish order honours @tbm-insight\/charlie -> @tbm-insight\/alpha/)
  })

  it('ignores devDependencies when ordering', () => {
    const tbm = releaseFamily('tbm')
    const members = [
      member('packages/a/alpha', '@tbm-insight/alpha', { devDependencies: { '@tbm-insight/zebra': 'workspace:^' } }),
      member('packages/a/zebra', '@tbm-insight/zebra'),
    ]

    // A dev dependency is absent from the published package, so it must not move
    // the consumer behind it.
    expect(tbm.publishOrder(members).order.map(entry => entry.name)).toEqual([
      '@tbm-insight/alpha',
      '@tbm-insight/zebra',
    ])
  })

  it('applies the harness payload policy to tbm and keeps upstream payloads for vendored packages', () => {
    const tbm = releaseFamily('tbm')
    const vendor = releaseFamily('vendor')
    const harness = member('packages/a/library', '@tbm-insight/library')
    const vendored = member('vendor/cordis', '@tbm-insight/cordis')

    expect(() => { tbm.validatePayload(harness, ['package/lib/index.js', 'package/src/index.ts']) })
      .toThrow(/publishes source file/)
    expect(() => { vendor.validatePayload(vendored, ['package/lib/index.js', 'package/src/index.ts']) }).not.toThrow()
    expect(() => { vendor.validatePayload(vendored, []) }).toThrow(/empty tarball/)
  })

  it('drives the installed entry only for the family that publishes one', () => {
    expect(releaseFamily('tbm').installedEntry).toEqual({ packageName: '@tbm-insight/cli', binPath: 'lib/bin.js' })
    expect(releaseFamily('vendor').installedEntry).toBeUndefined()
  })

  it('rejects an unknown family identifier', () => {
    expect(() => { releaseFamily('native') }).toThrow(/unknown release family/)
  })
})

describe('vendored version baseline', () => {
  it('drops an upstream prerelease segment and increments the patch', () => {
    expect(nextVendorVersion('4.0.0-rc.7', undefined)).toBe('4.0.1')
    expect(nextVendorVersion('1.0.0-rc.5', undefined)).toBe('1.0.1')
    expect(nextVendorVersion('1.8.1', undefined)).toBe('1.8.2')
  })

  it('increments from the last published version when a re-sync restored a lower one', () => {
    // Upstream moved rc.7 -> rc.8 after this repository published 4.0.1;
    // incrementing the manifest alone would name 4.0.1 a second time.
    expect(nextVendorVersion('4.0.0-rc.8', '4.0.1')).toBe('4.0.2')
    expect(nextVendorVersion('4.1.0', '4.0.1')).toBe('4.1.1')
  })

  it('appends a rehearsal prerelease without consuming its release numbers', () => {
    // A rehearsal burns 4.0.1-rc.1 and leaves 4.0.1 free, so the stable release
    // that follows takes those same numbers instead of skipping to 4.0.2.
    expect(nextVendorVersion('4.0.0-rc.7', undefined, 'rc.1')).toBe('4.0.1-rc.1')
    expect(nextVendorVersion('4.0.0-rc.7', '4.0.1-rc.1', 'rc.2')).toBe('4.0.1-rc.2')
    expect(nextVendorVersion('4.0.0-rc.7', '4.0.1-rc.1')).toBe('4.0.1')
    expect(nextVendorVersion('4.0.0-rc.7', '4.0.1')).toBe('4.0.2')
  })
})

describe('version precedence', () => {
  it('orders alpha, canary, and release-candidate versions by semver precedence', () => {
    expect(compareVersions('4.0.1-alpha.1', '4.0.1-canary.1')).toBeLessThan(0)
    expect(compareVersions('4.0.1-canary.1', '4.0.1-rc.1')).toBeLessThan(0)
    expect(compareVersions('4.0.1-rc.1', '4.0.1')).toBeLessThan(0)
  })

  it('ranks a release above the prerelease it follows', () => {
    // git --sort=v:refname disagrees, placing 4.0.1-rc.1 above 4.0.1, which is
    // why the newest published version is chosen here rather than by git.
    expect(compareVersions('4.0.1', '4.0.1-rc.1')).toBeGreaterThan(0)
    expect(compareVersions('4.0.1-rc.1', '4.0.1')).toBeLessThan(0)
  })

  it('compares numeric prerelease fields numerically', () => {
    expect(compareVersions('4.0.1-rc.10', '4.0.1-rc.1')).toBeGreaterThan(0)
    expect(compareVersions('4.0.1-rc.2', '4.0.1-rc.10')).toBeLessThan(0)
  })

  it('ranks a numeric field below an alphanumeric one, and a shorter list below a longer', () => {
    expect(compareVersions('4.0.1-1', '4.0.1-alpha')).toBeLessThan(0)
    expect(compareVersions('4.0.1-rc', '4.0.1-rc.1')).toBeLessThan(0)
    expect(compareVersions('4.0.2', '4.0.1')).toBeGreaterThan(0)
    expect(compareVersions('4.0.1-rc.1', '4.0.1-rc.1')).toBe(0)
  })
})

describe('payload change judgement', () => {
  const sourceShipping = member('vendor/cosmokit', '@tbm-insight/cosmokit', {
    files: ['lib/index.js', 'lib/types/**/*.d.ts', 'src'],
  })
  const buildOutputOnly = member('vendor/cordis', '@tbm-insight/cordis', {
    files: ['lib/index.js', 'lib/types/**/*.d.ts', 'bin.js'],
  })

  it('counts the manifest and the files npm always publishes', () => {
    expect(reachesPayload(sourceShipping, 'vendor/cosmokit/package.json')).toBe(true)
    expect(reachesPayload(sourceShipping, 'vendor/cosmokit/README.md')).toBe(true)
    expect(reachesPayload(sourceShipping, 'vendor/cosmokit/src/index.ts')).toBe(true)
  })

  it('counts build inputs for a package whose payload is build output', () => {
    // cordis publishes lib/ only, and lib/ is not tracked: without this, a real
    // source change reads as "nothing changed" and the next publish fails on a
    // version whose bytes moved.
    expect(reachesPayload(buildOutputOnly, 'vendor/cordis/src/context.ts')).toBe(true)
    expect(reachesPayload(buildOutputOnly, 'vendor/cordis/tsconfig.json')).toBe(true)
  })

  it('ignores paths no tarball carries', () => {
    expect(reachesPayload(sourceShipping, 'vendor/cosmokit/tests/unit.spec.ts')).toBe(false)
    expect(reachesPayload(sourceShipping, 'vendor/cosmokit/CHANGELOG.md')).toBe(false)
    // The README pattern is deliberately loose: over-reporting a change costs one
    // unnecessary patch bump, while under-reporting fails the next publish on a
    // version whose bytes moved.
    expect(reachesPayload(sourceShipping, 'vendor/cosmokit/README.i18n.yaml')).toBe(true)
    expect(reachesPayload(member('packages/a/library', '@tbm-insight/library', { files: ['lib/index.js'] }),
      'packages/a/library/tests/library.spec.ts')).toBe(false)
  })
})
