/** Explicit exceptions and Host packages for the published dependency policy. */

/** Packages treated as Client/Host packages without declaring `tbm.client`. */
const CLIENT_FACE_INCLUDE: readonly string[] = []

/** Packages exempted from automatic Client/Host treatment despite declaring `tbm.client`. */
const CLIENT_FACE_EXCLUDE: readonly string[] = [
  '@tbm-insight/api-session-controller',
  '@tbm-insight/api-workspace-controller',
]

/** Host-only packages whose peer relays are deliberately flattened. */
const HOST_DEPENDENCY_PACKAGES: readonly string[] = [
  '@tbm-insight/llm',
  '@tbm-insight/session',
]

/** Required Cordis services whose Host imports are type-only. */
const REQUIRED_SERVICE_PEERS = {
  '@tbm-insight/api-terminal-controller': ['@tbm-insight/subprocess'],
} as const satisfies Readonly<Record<string, readonly string[]>>

/** Development-only package relationships not represented by source imports. */
const CONFIGURATION_ONLY_DEV_DEPENDENCIES = {
  '@tbm-insight/client-locale': ['@tbm-insight/api-remotes'],
  '@tbm-insight/client-ui-conversation': [
    '@tbm-insight/api-remotes',
    '@tbm-insight/client-ui-workspace',
  ],
  '@tbm-insight/client-ui-model-selection': ['@tbm-insight/client-ui-input-trigger'],
  '@tbm-insight/client-ui-sidebar': ['@tbm-insight/client-ui-workspace'],
  '@tbm-insight/client-ui-subagent': ['@tbm-insight/client-ui-input-trigger'],
  '@tbm-insight/client-ui-theme': ['@tbm-insight/api-remotes'],
  '@tbm-insight/client-ui-tool': ['@tbm-insight/api-remotes'],
} as const satisfies Readonly<Record<string, readonly string[]>>

/** Workspace packages whose complete runtime surface is safe across duplicate installations. */
const DUPLICATE_SAFE_PACKAGES: readonly string[] = [
  '@tbm-insight/brand',
  '@tbm-insight/lazy-require',
  '@tbm-insight/typert-protocol',
  '@tbm-insight/util-code-language',
  '@tbm-insight/util-crypto',
  '@tbm-insight/util-values',
]

/**
 * Runtime exports whose values remain valid when npm installs another package copy.
 * New entries are forbidden by default. Automated agents must not add an
 * exception; every addition requires explicit human review and a dedicated,
 * prominent heading in the pull request description.
 */
const SAFE_HOST_DEPENDENCY_EXPORTS = {
  '@tbm-insight/atomic-write': ['withFileLock', 'writeFileAtomic'],
  '@tbm-insight/computer-use/brand': ['ComputerUseProviderName'],
  '@tbm-insight/credentials': ['credentialKey'],
  '@tbm-insight/deque': ['Deque'],
  // Builds a dispatcher from the resolved proxy policy; the caller owns and closes it.
  '@tbm-insight/http-proxy': ['createRouteDispatcher'],
  // The Liveshare wire codec and identity helpers are stateless functions over caller-owned values.
  '@tbm-insight/experimental-liveshare-protocol': [
    'LIVESHARE_CAPABILITIES', 'LIVESHARE_PROTOCOL_VERSION', 'parseRelayFrame', 'parseShareAccessState',
    'parseTunnelWorkerCommand', 'parseTunnelWorkerEvent', 'rawText', 'sendFrame', 'unsupportedFrameRefusal',
    'viewerRequestFields', 'identityFromKey', 'identityKeyOf',
  ],
  // The shipped profile templates are plain data; a consumer reads their bundle names only.
  '@tbm-insight/official-bundles': ['PROFILE_TEMPLATES'],
  '@tbm-insight/llm': ['callConfigEquals'],
  '@tbm-insight/session': ['SessionId'],
  '@tbm-insight/session-format': ['sessionFormatLogFilename'],
  '@tbm-insight/storage-domain': ['defineDomain'],
  '@tbm-insight/timeout': ['MAX_TIMER_DELAY_MS'],
  '@tbm-insight/schemastery': ['default'],
} as const satisfies HostDependencyExports

/** Runtime exports that require every consumer to resolve the provider's shared peer instance. */
const PEER_REQUIRED_HOST_EXPORTS = {
  // Profile settings must match the installed Node provider's configuration schema.
  '@tbm-insight/ptc-runtime-node/configuration': ['resolvePersistentExecution'],
  // CUA checks UserQuestionError and preserves AttachmentError from image admission.
  '@tbm-insight/attachment': ['admitEncodedImages'],
  '@tbm-insight/user-questions': ['UserQuestionError'],
  // `instanceof` checks need the translator's own class instance.
  '@tbm-insight/experimental-translator': ['TranslationError'],
  // Stateless; a safe classification would turn the forge panel's forge and worktree peers into dependencies.
  '@tbm-insight/experimental-forge': ['changeRequestKey'],
  '@tbm-insight/experimental-worktree': ['generatedWorktreeName'],
  // The forge panel matches ctx.fs failures with `instanceof FsError`.
  '@tbm-insight/fs': ['FsError'],
  '@tbm-insight/scope': ['carrierKeyOf', 'createScope', 'scopeOf', 'scopeTarget'],
  // appendPluginRecord writes through the Session class's private log; pluginRecordOf is stateless.
  '@tbm-insight/session': ['SESSION_FORMAT_VERSION', 'appendPluginRecord', 'pluginRecordOf'],
  '@tbm-insight/session-persistence': ['SessionPersistenceNotFoundError'],
  // Readers recognize a deadline's TimeoutReason only by `instanceof` against their own copy.
  '@tbm-insight/timeout': ['deadline'],
} as const satisfies HostDependencyExports

/** Exact import specifier to reviewed runtime exports. */
type HostDependencyExports = Readonly<Record<string, readonly string[]>>

/** Complete configurable input to package dependency classification. */
export interface PackageDependencyPolicy {
  readonly clientFaceInclude: readonly string[]
  readonly clientFaceExclude: readonly string[]
  readonly hostPackages: readonly string[]
  readonly requiredServicePeers?: Readonly<Record<string, readonly string[]>>
  readonly configurationOnlyDevDependencies: Readonly<Record<string, readonly string[]>>
  readonly duplicateSafePackages?: readonly string[]
  readonly safeHostDependencyExports: HostDependencyExports
  readonly peerRequiredHostExports: HostDependencyExports
}

/** Repository dependency policy consumed by verification and benchmarking. */
export const PACKAGE_DEPENDENCY_POLICY: PackageDependencyPolicy = {
  clientFaceInclude: CLIENT_FACE_INCLUDE,
  clientFaceExclude: CLIENT_FACE_EXCLUDE,
  hostPackages: HOST_DEPENDENCY_PACKAGES,
  requiredServicePeers: REQUIRED_SERVICE_PEERS,
  configurationOnlyDevDependencies: CONFIGURATION_ONLY_DEV_DEPENDENCIES,
  duplicateSafePackages: DUPLICATE_SAFE_PACKAGES,
  safeHostDependencyExports: SAFE_HOST_DEPENDENCY_EXPORTS,
  peerRequiredHostExports: PEER_REQUIRED_HOST_EXPORTS,
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Whether a package manifest declares a dynamically loaded Client entry. */
export function hasClientDeclaration(tbmField: unknown): boolean {
  return isRecord(tbmField) && Object.hasOwn(tbmField, 'client')
}
