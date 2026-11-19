/** The package names the plugin manager protects, hides, orders, or marks experimental. */

/**
 * Plugin packages the plugin manager refuses to disable or remove, because management itself needs them; a bundle that
 * contains one is read-only as well. Removing a name drops only this `management-required` refusal; the manager's own
 * entry, installation-carried bundles, and unaddressable rows stay protected by their own rules.
 */
export const PROTECTED_PLUGINS: ReadonlySet<string> = new Set([
  '@tbm-insight/plugin-manager', '@tbm-insight/cordis-plugin-loader',
  '@tbm-insight/cordis-plugin-include', '@tbm-insight/api-gateway',
  '@tbm-insight/host-webserver', '@tbm-insight/client-modules',
  '@tbm-insight/client-ui-settings-plugin-inventory', '@tbm-insight/client-ui-plugin-manager',
  '@tbm-insight/host-plugin-inventory', '@tbm-insight/typert-registry',
  '@tbm-insight/api-remotes', '@tbm-insight/api-remote-access',
  '@tbm-insight/cordis-plugin-timer', '@tbm-insight/client-connection',
  '@tbm-insight/host-frontend-static', '@tbm-insight/tools',
  '@tbm-insight/hmr',
])

/**
 * Built-in profile bundles, persistent terminals, and the standalone worktree tool, which have no plugin manager page.
 * Their Host availability and activation stay intact.
 */
export const HIDDEN_BUNDLES: ReadonlySet<string> = new Set([
  '@tbm-insight/base',
  '@tbm-insight/web-app',
  '@tbm-insight/headless',
  '@tbm-insight/sdk-app',
  '@tbm-insight/acp-app',
  '@tbm-insight/sdk-minimal',
  '@tbm-insight/experimental-terminal-bundle',
  '@tbm-insight/experimental-tool-worktree',
])

/**
 * The optional bundles the plugin manager's main and More lists rank first, in this order. {@link MORE_BUNDLES}, not
 * this list, decides whether a bundle appears on the main list.
 */
export const EXTENSION_BUNDLES: readonly string[] = [
  '@tbm-insight/experimental-voice-input-bundle',
  '@tbm-insight/experimental-plugin-market-bundle',
  '@tbm-insight/experimental-auto-review',
]

/**
 * The optional bundles the plugin manager's main list leaves out until the profile enables them; its More list,
 * which includes every eligible bundle, ranks them last in this order.
 */
export const MORE_BUNDLES: readonly string[] = [
  '@tbm-insight/personalized-recommendations',
  '@tbm-insight/experimental-inspector-profile',
  '@tbm-insight/cua-bundle',
  '@tbm-insight/experimental-cot-translation-bundle',
  '@tbm-insight/experimental-session-search',
  '@tbm-insight/experimental-session-titles-bundle',
  '@tbm-insight/experimental-badge-skill-bundle',
  '@tbm-insight/experimental-ralph-bundle',
  '@tbm-insight/subagent-codex',
  '@tbm-insight/subagent-claude-code',
]

/** Official bundles the plugin manager marks with the Experimental badge. */
export const EXPERIMENTAL_BUNDLES: ReadonlySet<string> = new Set([
  '@tbm-insight/personalized-recommendations',
  '@tbm-insight/cua-bundle',
  '@tbm-insight/experimental-voice-input-bundle',
  '@tbm-insight/experimental-auto-review',
  '@tbm-insight/experimental-inspector-profile',
  '@tbm-insight/experimental-forge-bundle',
  '@tbm-insight/experimental-tool-worktree',
  '@tbm-insight/experimental-cot-translation-bundle',
  '@tbm-insight/experimental-session-search',
  '@tbm-insight/experimental-session-titles-bundle',
  '@tbm-insight/experimental-badge-skill-bundle',
  '@tbm-insight/experimental-ralph-bundle',
  '@tbm-insight/experimental-plugin-market-bundle',
  '@tbm-insight/experimental-liveshare',
])
