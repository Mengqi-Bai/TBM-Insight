/** The optional Developer Tools bundle enables both inspectors, including fetch capture. */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { entryListSchema } from '@tbm-insight/cordis-plugin-include'
import * as yaml from 'js-yaml'

describe('Inspector profile bundle', () => {
  it('publishes one layer containing both inspectors and the Statistics view', () => {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      publishConfig: { access: string }
      tbm: { bundle: { patch: string } }
      dependencies: Record<string, string>
    }
    expect(manifest.publishConfig.access).toBe('public')
    expect(manifest.tbm.bundle.patch).toBe('./cordis.patch.yml')
    expect(manifest.dependencies).toEqual({
      '@tbm-insight/experimental-client-ui-stats': 'workspace:*',
      '@tbm-insight/experimental-inspector': 'workspace:*',
      '@tbm-insight/experimental-session-inspector': 'workspace:*',
    })
    expect(yaml.load(readFileSync(new URL(`../${manifest.tbm.bundle.patch}`, import.meta.url), 'utf8'), {
      schema: entryListSchema,
    })).toEqual([{ insert: [
      {
        id: 'experimental-inspector', name: '@tbm-insight/experimental-inspector',
        disabled: false, config: { captureFetch: true },
      },
      { id: 'session-inspector', name: '@tbm-insight/experimental-session-inspector' },
      { id: 'client-ui-stats', name: '@tbm-insight/experimental-client-ui-stats' },
    ] }])
  })
})
