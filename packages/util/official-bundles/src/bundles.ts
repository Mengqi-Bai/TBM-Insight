/** The bundle package names the tbm installation selects, offers, installs on demand, or retires. */

/** Installation-owned defaults used when a shipped profile is first opened. */
export interface ProfileTemplate {
  /** Ordered bundle layer list. */
  bundles: readonly string[]
}

/** The shipped profile templates auto-initialized on first use, by name. */
export const PROFILE_TEMPLATES: Record<string, ProfileTemplate> = {
  acp: {
    bundles: ['@tbm-insight/base', '@tbm-insight/acp-app'],
  },
  web: {
    bundles: ['@tbm-insight/base', '@tbm-insight/web-app'],
  },
  headless: {
    bundles: ['@tbm-insight/base', '@tbm-insight/headless'],
  },
  sdk: {
    bundles: ['@tbm-insight/base', '@tbm-insight/sdk-app'],
  },
  'sdk-minimal': {
    bundles: ['@tbm-insight/sdk-minimal'],
  },
}

/**
 * Installation-owned bundle tuples that an earlier release wrote into a shipped profile; app-boot replaces an exact
 * match with the {@link PROFILE_TEMPLATES} entry of the same name and leaves every other list untouched.
 */
export const INSTALLATION_OWNED_PROFILE_TUPLES: Readonly<Record<string, readonly string[]>> = {
  headless: ['@tbm-insight/base', '@tbm-insight/web-app', '@tbm-insight/headless'],
}

/** Bundles an earlier release shipped and the installation no longer carries; app-boot removes them from profiles. */
export const RETIRED_BUNDLES: ReadonlySet<string> = new Set([
  // The Web composition mounts Schedule itself
  // ([upgrade guide](../../../../docs/upgrade-guide/v0.2.0-rc.2/schedule-bundle-retired/guide.md)).
  '@tbm-insight/experimental-schedule-bundle',
  '@tbm-insight/experimental-agent-team-profile',
])

/** The bundle list a `tbm plugin` init uses for a name with no shipped template. */
export const DEFAULT_PROFILE_BUNDLES: readonly string[] = ['@tbm-insight/base']

/**
 * The bundles the tbm installation ships for a person to switch on: each a
 * runtime dependency of the installation that declares `tbm.bundle.patch`,
 * an `icon`, and `./locale/*.json` display metadata, selected by no shipped
 * template, and offered switched off by the plugin manager except persistent
 * terminals, which have no page switch
 * ([rationale](../../../../.agents/notes/implemented/process/2026-09-15-shipped-optional-bundles.md),
 * [admission](../../../../.agents/notes/implemented/architecture/2026-09-21-experimental-capabilities-as-optional-bundles.md)).
 */
export const OPTIONAL_BUNDLES: readonly string[] = [
  '@tbm-insight/personalized-recommendations',
  '@tbm-insight/cua-bundle',
  '@tbm-insight/experimental-session-search',
  '@tbm-insight/experimental-ralph-bundle',
  '@tbm-insight/experimental-terminal-bundle',
  '@tbm-insight/experimental-badge-skill-bundle',
  '@tbm-insight/experimental-session-titles-bundle',
  '@tbm-insight/experimental-voice-input-bundle',
  '@tbm-insight/experimental-cot-translation-bundle',
  '@tbm-insight/experimental-auto-review',
  '@tbm-insight/experimental-inspector-profile',
  '@tbm-insight/experimental-liveshare',
  '@tbm-insight/experimental-plugin-market-bundle',
  '@tbm-insight/experimental-tool-worktree',
  '@tbm-insight/experimental-forge-bundle',
]

/** Public TBM_ENGINE release members available through the ordinary on-demand bundle installer. */
export const ON_DEMAND_BUNDLES: readonly string[] = [
  '@tbm-insight/subagent-claude-code',
  '@tbm-insight/subagent-codex',
]
