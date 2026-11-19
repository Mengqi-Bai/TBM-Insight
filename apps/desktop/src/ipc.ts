import type { DesktopFileActions } from '@tbm-insight/client-ui-file-actions/types'
/** Typed preload operations exposed only by the Electron shell. */

export type { DesktopChannelState, DesktopChannelChangeResult } from '@tbm-insight/client-ui-settings-general/types'
import type { DesktopChannelBridge, DesktopChannelState } from '@tbm-insight/client-ui-settings-general/types'
import type { DesktopKeyboardApi, DesktopShortcutsApi } from '@tbm-insight/client-shortcuts/protocol'
import type { IpcMainInvokeEvent } from 'electron'
import type { DesktopBrowserBridge } from '@tbm-insight/client-ui-sidebar-browser/types'
import type { DesktopFileDrag } from '@tbm-insight/util-file-drag'

/** IPC channel names kept private to the desktop application bundle. */
export const DESKTOP_IPC = {
  fileSave: 'tbm-desktop:file-save',
  clipboardImageRead: 'tbm-desktop:clipboard-image-read',
  shortcutsInput: 'tbm-desktop:shortcuts-input',
  shortcutsCloseWindow: 'tbm-desktop:shortcuts-close-window',
  shortcutsGet: 'tbm-desktop:shortcuts-get',
  shortcutsEdit: 'tbm-desktop:shortcuts-edit',
  shortcutsChanged: 'tbm-desktop:shortcuts-changed',
  shortcutsRecording: 'tbm-desktop:shortcuts-recording',
  boot: 'tbm-desktop:boot',
  enterWorkspace: 'tbm-desktop:enter-workspace',
  onboardingActive: 'tbm-desktop:onboarding-active',
  onboardingApiKey: 'tbm-desktop:onboarding-api-key',
  bootFailed: 'tbm-desktop:boot-failed',
  browserAcquire: 'tbm-desktop:browser-acquire',
  browserRelease: 'tbm-desktop:browser-release',
  browserOpenRequested: 'tbm-desktop:browser-open-requested',
  directoryPick: 'tbm-desktop:directory-pick',
  fileDragPrepare: 'tbm-desktop:file-drag-prepare',
  fileDragCancel: 'tbm-desktop:file-drag-cancel',
  fileDragStart: 'tbm-desktop:file-drag-start',
  fileDragRelease: 'tbm-desktop:file-drag-release',
  deviceInfo: 'tbm-desktop:device-info',
  localeBootstrap: 'tbm-desktop:locale-bootstrap',
  localeChanged: 'tbm-desktop:locale-changed',
  updatesChannelGet: 'tbm-desktop:updates-channel-get',
  updatesChannelSet: 'tbm-desktop:updates-channel-set',
  updatesChannelChanged: 'tbm-desktop:updates-channel-changed',
  updatesStatus: 'tbm-desktop:updates-status',
  updatesOpen: 'tbm-desktop:updates-open',
  updatesPresentation: 'tbm-desktop:updates-presentation',
  nativeThemeSet: 'tbm-desktop:native-theme-set',
  windowFullscreen: 'tbm-desktop:window-fullscreen',
  windowsAppearance: 'tbm-desktop:windows-appearance',
  windowsMenu: 'tbm-desktop:windows-menu',
} as const

/** Desktop release update state rendered by desktop-owned UI. */
export type DesktopUpdatePreparationFailureKind = 'stop-failed' | 'tasks-changed' | 'tasks-unavailable' | 'fullscreen-timeout'

export interface DesktopUpdateState {
  readonly phase: 'idle' | 'checking' | 'available' | 'downloading' | 'verifying' | 'installing' | 'ready' | 'error'
  readonly version?: string
  readonly message?: string
  /** Main-owned diagnostics without subprocess output or credentials; hidden until expanded. */
  readonly technicalDetails?: string
  readonly percent?: number
  readonly failedOperation?: 'check' | 'download' | 'install' | 'configuration'
  /** Main-owned preparation cause; UI wording is selected by the active locale. */
  readonly preparationFailure?: DesktopUpdatePreparationFailureKind
  /** Current filesystem failure, independent of previous cache cleanup attempts. */
  readonly downloadFailure?: 'space' | 'permission' | 'busy'
}

/** Classified failure copy selected by the Web locale without exposing raw updater diagnostics. */
export type DesktopUpdateFailureKind =
  | 'configuration'
  | 'check'
  | 'check-network'
  | 'download'
  | 'download-network'
  | 'download-space'
  | 'download-permission'
  | 'download-busy'
  | 'install'
  | 'install-network'
  | 'stop-failed'
  | 'tasks-changed'
  | 'tasks-unavailable'
  | 'fullscreen-timeout'

/** Semantic status content; actions open main-process confirmation dialogs only. */
export interface DesktopUpdatePresentation {
  readonly phase: DesktopUpdateState['phase']
  readonly version?: string
  readonly percent?: number
  readonly failure?: DesktopUpdateFailureKind
  readonly configurationError?: DesktopChannelState['error']
}

/** Product documents cannot supply update versions, package URLs, or installation authorization. */
export interface TbmDesktopProductApi {
  readonly fileActions: DesktopFileActions
  readonly protocolVersion: 1
  readonly browser: DesktopBrowserBridge
  readonly fileDrag: DesktopFileDrag
  readonly keyboard: DesktopKeyboardApi
  readonly shortcuts: DesktopShortcutsApi
  /**
   * Local machine description for the feedback questionnaire.
   * @returns `name=value` fields separated by `; `, with no hostname, user name, or serial number.
   */
  deviceInfo(): Promise<string>
  readonly updates: {
    readonly channels: DesktopChannelBridge
    status(): Promise<DesktopUpdatePresentation>
    open(): Promise<void>
    subscribe(listener: (state: DesktopUpdatePresentation) => void): () => void
  }
}

/** Scheme of Desktop-owned application documents. */
export const SCHEME = 'tbm-app'

/**
 * Reject IPC outside the allowed Desktop document origins.
 * @param event - IPC caller whose frame URL supplies the origin.
 * @param hostnames - Desktop document hosts allowed for this operation.
 */
export function assertDesktopSender(event: IpcMainInvokeEvent, hostnames: readonly string[]): void {
  const senderFrame = event.senderFrame
  if (senderFrame === null) throw new Error('tbm desktop: rejected IPC without a sender frame')
  const url = new URL(senderFrame.url)
  if (url.protocol !== `${SCHEME}:` || !hostnames.includes(url.hostname)) {
    throw new Error('tbm desktop: rejected IPC from an unowned renderer')
  }
}
