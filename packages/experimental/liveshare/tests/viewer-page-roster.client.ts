/**
 * Test-only client roster of the assembled viewer page.
 *
 * A served viewer page is the owner's own Web shell with the owner's client plugins; this roster is the
 * subset the viewer page specs need: the wire plugin, the Gateway, remote access, the Session/Workspace controllers,
 * the menu service, presentation plugins, and the Liveshare `./client` face, which mounts the viewer surfaces when the
 * carrier names a share. Every row is the package's own `/client` face registered as a module-table
 * factory. It must be imported only after {@link prepareViewerRemoteFaces} answered the generated
 * `/remote` faces these plugins import.
 *
 * @module @tbm-insight/experimental-liveshare/tests/viewer-page-roster
 */

import * as apiGateway from '@tbm-insight/api-gateway/client'
import * as apiRemoteAccess from '@tbm-insight/api-remote-access/client'
import * as apiRemotes from '@tbm-insight/api-remotes/client'
import * as apiSessionController from '@tbm-insight/api-session-controller/client'
import * as apiWorkspaceController from '@tbm-insight/api-workspace-controller/client'
import * as clientConnection from '@tbm-insight/client-connection/client'
import * as clientFileUpload from '@tbm-insight/client-file-upload/client'
import * as clientLocale from '@tbm-insight/client-locale/client'
import * as clientModules from '@tbm-insight/client-modules/client'
import * as clientResources from '@tbm-insight/client-resources/client'
import * as clientShortcuts from '@tbm-insight/client-shortcuts/client'
import * as uiAttachment from '@tbm-insight/client-ui-attachment/client'
import * as uiChat from '@tbm-insight/client-ui-chat/client'
import * as uiContextMenu from '@tbm-insight/client-ui-context-menu/client'
import * as uiConversation from '@tbm-insight/client-ui-conversation/client'
import * as uiDeliverables from '@tbm-insight/client-ui-deliverables/client'
import * as uiFileDrag from '@tbm-insight/client-ui-file-drag/client'
import * as uiLayout from '@tbm-insight/client-ui-layout/client'
import * as uiRenderer from '@tbm-insight/client-ui-renderer/client'
import * as uiSession from '@tbm-insight/client-ui-session/client'
import * as uiSettings from '@tbm-insight/client-ui-settings/client'
import * as uiSidebar from '@tbm-insight/client-ui-sidebar/client'
import * as uiSidebarRight from '@tbm-insight/client-ui-sidebar-right/client'
import * as uiTheme from '@tbm-insight/client-ui-theme/client'
import * as uiTool from '@tbm-insight/client-ui-tool/client'
import * as uiTrajectory from '@tbm-insight/client-ui-trajectory/client'
import * as uiWorkspace from '@tbm-insight/client-ui-workspace/client'
import * as typertRegistry from '@tbm-insight/typert-registry/client'
import * as liveshare from '../src/client/index.ts'

/** One module-table row: the entry id the Loader creates, and that plugin's client exports. */
export interface ViewerPageRosterRow {
  readonly id: string
  readonly exports: Readonly<Record<string, unknown>>
}

/** Entry id of the module-system bootstrap whose exports the facade hands to the module system. */
export const VIEWER_PAGE_BOOTSTRAP_ID = '@tbm-insight/client-modules'

/** The viewer page roster; Cordis composes these entries by service injection, so order is irrelevant. */
export const VIEWER_PAGE_ROSTER: readonly ViewerPageRosterRow[] = [
  { id: '@tbm-insight/typert-registry', exports: typertRegistry },
  { id: '@tbm-insight/experimental-liveshare', exports: liveshare },
  { id: VIEWER_PAGE_BOOTSTRAP_ID, exports: clientModules },
  { id: '@tbm-insight/client-connection', exports: clientConnection },
  { id: '@tbm-insight/api-gateway', exports: apiGateway },
  { id: '@tbm-insight/api-remote-access', exports: apiRemoteAccess },
  { id: '@tbm-insight/api-remotes', exports: apiRemotes },
  { id: '@tbm-insight/api-session-controller', exports: apiSessionController },
  { id: '@tbm-insight/api-workspace-controller', exports: apiWorkspaceController },
  { id: '@tbm-insight/client-file-upload', exports: clientFileUpload },
  { id: '@tbm-insight/client-locale', exports: clientLocale },
  { id: '@tbm-insight/client-resources', exports: clientResources },
  { id: '@tbm-insight/client-shortcuts', exports: clientShortcuts },
  { id: '@tbm-insight/client-ui-renderer', exports: uiRenderer },
  { id: '@tbm-insight/client-ui-theme', exports: uiTheme },
  { id: '@tbm-insight/client-ui-settings', exports: uiSettings },
  { id: '@tbm-insight/client-ui-layout', exports: uiLayout },
  { id: '@tbm-insight/client-ui-session', exports: uiSession },
  { id: '@tbm-insight/client-ui-sidebar', exports: uiSidebar },
  { id: '@tbm-insight/client-ui-conversation', exports: uiConversation },
  { id: '@tbm-insight/client-ui-chat', exports: uiChat },
  { id: '@tbm-insight/client-ui-context-menu', exports: uiContextMenu },
  { id: '@tbm-insight/client-ui-tool', exports: uiTool },
  { id: '@tbm-insight/client-ui-attachment', exports: uiAttachment },
  { id: '@tbm-insight/client-ui-file-drag', exports: uiFileDrag },
  { id: '@tbm-insight/client-ui-sidebar-right', exports: uiSidebarRight },
  { id: '@tbm-insight/client-ui-trajectory', exports: uiTrajectory },
  { id: '@tbm-insight/client-ui-deliverables', exports: uiDeliverables },
  { id: '@tbm-insight/client-ui-workspace', exports: uiWorkspace },
]
