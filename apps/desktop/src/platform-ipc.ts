/** Shared names for the desktop Platform bridge. */
/** Private desktop channels; the Platform renderer receives bootstrap and locale updates. */
export const PLATFORM_IPC = {
  bootstrap: 'tbm-platform:bootstrap',
  localeChanged: 'tbm-platform:locale-changed',
  open: 'tbm-platform:open',
  bounds: 'tbm-platform:bounds',
  close: 'tbm-platform:close',
} as const

/** Resolved Platform language; Desktop resolves the system preference before sending it. */
export type PlatformLocale = 'en_US' | 'zh_CN'
