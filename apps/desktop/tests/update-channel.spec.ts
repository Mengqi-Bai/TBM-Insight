import { expect, it } from 'vitest'
import { desktopUpdateChannel } from '../src/update-channel.ts'

it('reads the installed channel independently from the current version', () => {
  expect(desktopUpdateChannel({ version: '1.0.0', tbmDesktopUpdateChannel: 'nightly' })).toBe('nightly')
  expect(desktopUpdateChannel({ version: '1.0.0', tbmDesktopUpdateChannel: 'stable' })).toBe('stable')
  expect(desktopUpdateChannel({ version: '1.0.0' })).toBe('nightly')
  expect(() => desktopUpdateChannel({ tbmDesktopUpdateChannel: 'latest' })).toThrow(/channel/u)
  expect(() => desktopUpdateChannel({ tbmDesktopUpdateChannel: 'beta' })).toThrow(/channel/u)
  expect(() => desktopUpdateChannel(null)).toThrow(/manifest/u)
})
