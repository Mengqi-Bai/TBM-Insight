/** Platform-neutral assembly of generated Host Remote contributions. */

import type { Context } from '@tbm-insight/cordis'
import productAnalyticsRemote from '@tbm-insight/client-product-analytics/remote'
export type {} from '@tbm-insight/client-product-analytics/remote'
import agentPresetsRemote from '@tbm-insight/agent-preset-registry/remote'
import userQuestionsRemote from '@tbm-insight/user-questions/remote'
import commandsRemote from '@tbm-insight/commands/remote'
import agentTeamsRemote from '@tbm-insight/agent-team/remote'
export type {} from '@tbm-insight/agent-team/remote'
import accountRemote from '@tbm-insight/api-account-controller/remote'
import settingsControllerRemote from '@tbm-insight/api-settings-controller/remote'
import officeToPdfRemote from '@tbm-insight/office-to-pdf/remote'
import goalsRemote from '@tbm-insight/goal/remote'
import scheduleRemote from '@tbm-insight/schedule/remote'
import llmRemote from '@tbm-insight/llm/remote'
import dynamicRemote from '@tbm-insight/cordis-host-runner/remote'
import pluginManagerRemote from '@tbm-insight/plugin-manager/remote'
import mcpManagerRemote from '@tbm-insight/mcp-manager/remote'
import toolResultsRemote from '@tbm-insight/client-ui-trajectory/remote'
import pluginRegistryProbeRemote from '@tbm-insight/client-ui-plugin-manager/remote'
import pluginMarketRemote from '@tbm-insight/plugin-market/remote'
import pluginInventoryRemote from '@tbm-insight/host-plugin-inventory/remote'
import messageFeedbackRemote from '@tbm-insight/message-feedback/remote'
import permissionPresetsRemote from '@tbm-insight/permission-presets/remote'
import sessionFeedbackRemote from '@tbm-insight/command-feedback/remote'
import fileUploadsRemote from '@tbm-insight/client-file-upload/remote'
import sessionReferencesRemote from '@tbm-insight/session-reference/remote'
import subagentsRemote from '@tbm-insight/subagent/remote'
import sessionRemote from '@tbm-insight/api-session-controller/remote'
import jobRemote from '@tbm-insight/api-job-controller/remote'
import workspaceRemote from '@tbm-insight/api-workspace-controller/remote'
import terminalRemote from '@tbm-insight/api-terminal-controller/remote'
import workspaceFilesRemote from '@tbm-insight/api-workspace-files/remote'
import webRemote from '@tbm-insight/web/remote'
import type { ClientRemote } from '@tbm-insight/api-gateway/client'

export type { ClientRemote } from '@tbm-insight/api-gateway/client'
export type {
  BundleDetail, BundleInfo, BundleRowInfo, ChangeResult, IncompatiblePlugin, InspectOptions, InstallBundleOptions, InstallSpecKind,
  ManagementError, PackageResult,
  PluginChange, PluginEntryId, PluginInfo, PluginInspectProblem, PluginInstallCancellation, PluginInstallFailureKind,
  PluginInstallLogChunk, PluginInstallProgress, PluginInstallRequestId, PluginRegistries, PluginSpecInspection,
  PluginUpdateProgress, PluginUpdateResult, PluginUpdateStep, PluginVersion, PluginVersionList, RegistryAttempt,
  ReadOnlyReason, Registry, RestartReason,
} from '@tbm-insight/plugin-manager/types'
export type { McpManagedServerStatus, McpManagedServerView } from '@tbm-insight/mcp-manager/types'
export type {} from '@tbm-insight/plugin-manager/remote'
export type {} from '@tbm-insight/mcp-manager/remote'
export type {} from '@tbm-insight/client-ui-plugin-manager/remote'
export type {} from '@tbm-insight/client-ui-trajectory/remote'
export type {} from '@tbm-insight/plugin-market/remote'
export type {
  MarketCompatibility, MarketIndexSummary, MarketInstallation, MarketInstallationStatus, MarketListingEntry, MarketListingVersion,
  MarketQuery, MarketSearchResult, MarketSort, PluginDetail, PluginDetailDocumentId, PluginDetailOrigin,
} from '@tbm-insight/plugin-market/types'
export type { PluginInventorySnapshot } from '@tbm-insight/host-plugin-inventory/types'
export type {} from '@tbm-insight/agent-preset-registry/remote'
export type {} from '@tbm-insight/user-questions/remote'
export type {} from '@tbm-insight/commands/remote'
export type {} from '@tbm-insight/web/remote'
export type {} from '@tbm-insight/api-settings-controller/remote'
export type {} from '@tbm-insight/api-account-controller/remote'
export type {} from '@tbm-insight/goal/remote'
export type {} from '@tbm-insight/schedule/remote'
export type {} from '@tbm-insight/office-to-pdf/remote'
export type {} from '@tbm-insight/llm/remote'
export type {} from '@tbm-insight/host-plugin-inventory/remote'
export type {} from '@tbm-insight/message-feedback/remote'
export type {} from '@tbm-insight/permission-presets/remote'
export type {} from '@tbm-insight/command-feedback/remote'
export type {} from '@tbm-insight/client-file-upload/remote'
export type {} from '@tbm-insight/session-reference/remote'
export type {} from '@tbm-insight/subagent/remote'
export type * from '@tbm-insight/subagent/client'
export type {} from '@tbm-insight/api-session-controller/remote'
export type * from '@tbm-insight/api-session-controller/types'
export type {} from '@tbm-insight/api-job-controller/remote'
export type * from '@tbm-insight/api-job-controller/types'
export type {} from '@tbm-insight/api-workspace-controller/remote'
export type * from '@tbm-insight/api-workspace-controller/types'
export type {} from '@tbm-insight/api-workspace-files/remote'
export type * from '@tbm-insight/api-workspace-files/types'
export type {} from '@tbm-insight/api-terminal-controller/remote'
export type * from '@tbm-insight/api-terminal-controller/types'
// The forwarded-event allowlist's selection seat: without it in the consumer's
// compilation face `TypertRemoteEvent` is `never` and every `$on` call fails.
export type { ApiRemoteForwardedEvent } from '../types.ts'
// The owner packages' client-safe `./types` exports supply the `Events`
// signatures `$on` hands to a listener, so a consumer reads the very
// declaration the Host emits rather than a flattened restatement of it.
export type {} from '@tbm-insight/commands/types'
export type {} from '@tbm-insight/web/types'
export type {} from '@tbm-insight/cordis-host-runner/types'
export type {} from '@tbm-insight/credentials/types'
export type {} from '@tbm-insight/llm/types'
export type {} from '@tbm-insight/agent-preset-registry/types'
export type {} from '@tbm-insight/permission-presets/types'
export type {} from '@tbm-insight/settings/types'
export type {} from '@tbm-insight/user-approval/types'
export type {} from '@tbm-insight/user-questions/types'
export type {} from '@tbm-insight/api-session-controller/types'

/**
 * The carrier's Client-facing types, re-exported so a business package names one
 * assembly package instead of both this facade and the Connection plugin. Type-only:
 * the carrier's runtime values stay behind their own module edge.
 */
export type {
  ConnectionHandle, ConnectionSinks, ContentBlock,
  MessageId,
  RpcId, RpcRequest, RpcResponse, RpcResult, SessionId,
  StreamChunk,
} from '@tbm-insight/client-connection/client'
export type {} from '@tbm-insight/api-gateway/client'
export type {} from '@tbm-insight/cordis-host-runner/remote'

// The payload vocabulary of the selected namespaces, re-exported so a Client
// contribution can name what it sends and receives without importing a Host
// package: this assembly is the one place both planes legitimately meet.
export type {
  ApprovalRequestId,
  CordisHalfState,
  CordisDynamicPackageId,
  CordisDynamicPluginId,
  CordisDynamicPluginRunId,
  CordisDynamicRunMode,
  CordisInspectMethodManifest,
  CordisInspectPlatform,
  CordisInspectProviderManifest,
  CordisInspectProviderView,
  CordisInspectQueryRequest,
  CordisInspectQueryResolution,
  CordisInspectQueryResolved,
  CordisInspectRequestId,
  CordisInspectResolveAck,
  CordisRunDiagnostic,
  CordisRunStatus,
  DynamicCordisClientSource,
  DynamicCordisHostHalfResult,
  DynamicCordisInventoryRow,
  DynamicCordisInvokeResult,
  DynamicCordisPackage,
  DynamicCordisRequestResolved,
  DynamicCordisResolveAck,
  DynamicCordisRetracted,
  DynamicCordisRunRequest,
  DynamicCordisRunResolution,
  DynamicCordisRunAttempt,
  DynamicCordisRunResponse,
  DynamicCordisStopResponse,
  DynamicCordisUndefineReceipt,
  RequestRunOutcome,
} from '@tbm-insight/cordis-host-runner/types'
// Credential state vocabulary for the credentials namespace (values never ride it).
export type { CredentialInfo } from '@tbm-insight/credentials/types'
// Redacted namespace vocabulary for the settings namespace (secrets never ride
// it). It travels with its seam, whose `./types` the Client face already reads.
export type {
  SettingsDescribeValue, SettingsNamespaceView, SettingsPathOpView, SettingsSecretView,
} from '@tbm-insight/settings/types'
// Provider registry and discovery vocabulary for the llm namespace.
export type {
  LlmConfigurableProvider, LlmDiscoveredModel,
  LlmModelDiscoveryRequest, LlmNativeAuth, LlmProviderInfo,
} from '@tbm-insight/llm/types'
// Reference-discovery result vocabulary for the fileReferences and
// sessionReferenceResolver namespaces.
export type { FileReferenceCandidate } from '@tbm-insight/file-reference/types'
export type { SessionReferenceMentionCandidate } from '@tbm-insight/session-reference/types'

// The Remote failure vocabulary, re-exported so business packages keep naming
// this assembly alone. Types only: a value export would make spec imports load
// this module's owner /remote artifacts; specs take RemoteError from
// tbm-client-test-runtime instead.
export type {
  RemoteErrorCode, RemoteErrorDetailsMap, RemoteFailure, RemoteResult,
} from '@tbm-insight/typert-protocol'
export type { RemoteHostFacts } from '@tbm-insight/api-gateway/client'

declare module '@tbm-insight/cordis' {
  interface Context {
    /** Generated Remote namespaces selected by this Client assembly. */
    remote: ClientRemote
  }
}

/** Required service: the typed Client Remote contribution mount. */
export const inject = ['remote']

/**
 * Mount the Host capabilities explicitly selected for this Client assembly.
 * @param ctx - Client Cordis root carrying the typed API service.
 * @returns disposer after every selected Remote namespace is ready.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  const disposers: Array<() => Promise<void>> = []
  try {
    for (const contribution of [
      productAnalyticsRemote, agentPresetsRemote, commandsRemote, agentTeamsRemote, settingsControllerRemote, accountRemote,
      goalsRemote, llmRemote, dynamicRemote, scheduleRemote,
      pluginInventoryRemote, pluginManagerRemote, mcpManagerRemote, pluginMarketRemote, pluginRegistryProbeRemote,
      toolResultsRemote,
      messageFeedbackRemote, sessionFeedbackRemote,
      fileUploadsRemote, sessionReferencesRemote,
      permissionPresetsRemote, subagentsRemote, sessionRemote, jobRemote, workspaceRemote, workspaceFilesRemote, terminalRemote,
      officeToPdfRemote, userQuestionsRemote, webRemote,
    ]) {
      disposers.push(await ctx.remote.$mount(contribution))
    }
  } catch (error) {
    for (const dispose of disposers.reverse()) await dispose()
    throw error
  }
  // Unwound in reverse mount order, so a namespace never outlives one mounted
  // after it.
  return async () => {
    for (const dispose of disposers.reverse()) await dispose()
  }
}
