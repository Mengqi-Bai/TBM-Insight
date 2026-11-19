/**
 * Registry tests for `@tbm-insight/shell-env`: built-in facts, contributor
 * ownership and validation, collection ordering, effect-scoped disposal, and
 * the explicit disposer contract.
 */

import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@tbm-insight/cordis'
import { ToolCallId } from '@tbm-insight/llm'
import type { Agent } from '@tbm-insight/agent'
import { SESSION_FORMAT_VERSION } from '@tbm-insight/session'
import type { ToolExecution } from '@tbm-insight/tools'
import { ShellEnvRegistry } from '@tbm-insight/shell-env'
import * as BashEnvPlugin from '@tbm-insight/shell-env'

const testToolSignal = new AbortController().signal

afterEach(() => vi.unstubAllEnvs())

function execution(sessionId?: string): ToolExecution {
  return {
    signal: testToolSignal,
    token: Symbol('bash-env-test') as ToolExecution['token'],
    callId: ToolCallId('bash-env-call'),
    rootCallId: ToolCallId('bash-env-call'),
    name: 'bash',
    arguments: { command: 'true' },
    ...(sessionId === undefined
      ? {}
      : {
        agent: {
          session: {
            header: { version: SESSION_FORMAT_VERSION, id: sessionId, createdAt: 0, isSeeded: false },
          },
        } as unknown as Agent,
      }),
  }
}

describe('ShellEnvRegistry', () => {
  it('collects unconditional shell facts and the current agent session id', () => {
    const ctx = new Context()
    const registry = new ShellEnvRegistry(ctx, { tbmHome: './test-tbm-home' })

    expect(registry.collect(execution())).toEqual({
      TBM_ENGINE_HOME: resolve('./test-tbm-home'),
      TBM_ENGINE_SHELL: '1',
    })
    expect(registry.collect(execution('session-a'))).toEqual({
      TBM_ENGINE_HOME: resolve('./test-tbm-home'),
      TBM_ENGINE_SESSION_ID: 'session-a',
      TBM_ENGINE_SHELL: '1',
    })
  })

  it('collects the launcher-provided profile name and directory when a profile context exists', () => {
    const ctx = new Context()
    ctx.provide('profileContext', {
      name: 'web', dir: '/profiles/web', patchPath: '/profiles/web/cordis.patch.yml', installAnchor: '/tbm/package.json',
      cwd: '/work', home: '/home', startedBundles: [], overlays: [], telemetryDisabledEnv: undefined,
    })
    const registry = new ShellEnvRegistry(ctx, { tbmHome: './test-tbm-home' })
    expect(registry.collect(execution())).toMatchObject({ TBM_ENGINE_PROFILE: 'web', TBM_ENGINE_PROFILE_DIR: '/profiles/web' })
    expect(() => registry.register({
      name: 'profile-claimer',
      variables: { TBM_ENGINE_PROFILE: { description: 'Reserved key.' } },
      resolve: () => ({}),
    })).toThrow(/reserved key "TBM_ENGINE_PROFILE"/)
  })

  it('resolves TBM_ENGINE_HOME from the ambient override or the user-home default', () => {
    vi.stubEnv('TBM_ENGINE_HOME', './ambient-tbm-home')
    const fromEnvironment = new ShellEnvRegistry(new Context())
    expect(fromEnvironment.collect(execution()).TBM_ENGINE_HOME).toBe(resolve('./ambient-tbm-home'))

    vi.stubEnv('TBM_ENGINE_HOME', undefined)
    const fromDefault = new ShellEnvRegistry(new Context())
    expect(fromDefault.collect(execution()).TBM_ENGINE_HOME).toBe(join(homedir(), '.tbm'))
  })

  it('collects declared contributor variables and omits unavailable values', () => {
    const ctx = new Context()
    const registry = new ShellEnvRegistry(ctx, { tbmHome: './test-tbm-home' })
    registry.register({
      name: 'optional-session-fact',
      variables: {
        TBM_ENGINE_SESSION_OPTIONAL: { description: 'Optional session-scoped test fact.' },
      },
      resolve: exec => exec.agent === undefined ? {} : { TBM_ENGINE_SESSION_OPTIONAL: exec.agent.session.header.id },
    })
    registry.register({
      name: 'always-available-fact',
      variables: {
        TBM_ENGINE_ALWAYS_AVAILABLE: { description: 'Always-available test fact.' },
      },
      resolve: () => ({ TBM_ENGINE_ALWAYS_AVAILABLE: 'yes' }),
    })

    expect(registry.collect(execution())).not.toHaveProperty('TBM_ENGINE_SESSION_OPTIONAL')
    expect(registry.collect(execution()).TBM_ENGINE_ALWAYS_AVAILABLE).toBe('yes')
    expect(registry.collect(execution('session-b')).TBM_ENGINE_SESSION_OPTIONAL).toBe('session-b')
    expect(registry.list()).toEqual([
      {
        contributor: 'always-available-fact',
        description: 'Always-available test fact.',
        key: 'TBM_ENGINE_ALWAYS_AVAILABLE',
      },
      {
        contributor: 'optional-session-fact',
        description: 'Optional session-scoped test fact.',
        key: 'TBM_ENGINE_SESSION_OPTIONAL',
      },
    ])
  })

  it('rejects duplicate variable ownership at registration time', () => {
    const ctx = new Context()
    const registry = new ShellEnvRegistry(ctx, { tbmHome: './test-tbm-home' })
    registry.register({
      name: 'first',
      variables: { TBM_ENGINE_SHARED: { description: 'First owner.' } },
      resolve: () => ({ TBM_ENGINE_SHARED: 'first' }),
    })

    expect(() => registry.register({
      name: 'second',
      variables: { TBM_ENGINE_SHARED: { description: 'Second owner.' } },
      resolve: () => ({ TBM_ENGINE_SHARED: 'second' }),
    })).toThrow(/TBM_ENGINE_SHARED.*first.*second|TBM_ENGINE_SHARED.*second.*first/)
  })

  it('rejects duplicate contributor names and malformed declarations', () => {
    const registry = new ShellEnvRegistry(new Context(), { tbmHome: './test-tbm-home' })
    registry.register({
      name: 'declared',
      variables: { TBM_ENGINE_DECLARED: { description: 'Declared fact.' } },
      resolve: () => ({}),
    })

    expect(() => registry.register({
      name: 'declared',
      variables: { TBM_ENGINE_ANOTHER: { description: 'Another fact.' } },
      resolve: () => ({}),
    })).toThrow(/already registered/)
    expect(() => registry.register({
      name: ' ',
      variables: { TBM_ENGINE_BLANK_NAME: { description: 'Blank owner.' } },
      resolve: () => ({}),
    })).toThrow(/name must be non-empty/)
    expect(() => registry.register({
      name: 'invalid-key',
      variables: { tbm_invalid: { description: 'Invalid key.' } } as unknown as Record<'TBM_ENGINE_INVALID', { description: string }>,
      resolve: () => ({}),
    })).toThrow(/invalid key/)
    expect(() => registry.register({
      name: 'reserved-key',
      variables: { TBM_ENGINE_HOME: { description: 'Reserved key.' } },
      resolve: () => ({}),
    })).toThrow(/reserved key/)
    expect(() => registry.register({
      name: 'blank-description',
      variables: { TBM_ENGINE_BLANK_DESCRIPTION: { description: ' ' } },
      resolve: () => ({}),
    })).toThrow(/must describe/)
  })

  it('rejects undeclared variables returned by a contributor', () => {
    const ctx = new Context()
    const registry = new ShellEnvRegistry(ctx, { tbmHome: './test-tbm-home' })
    registry.register({
      name: 'drifted-provider',
      variables: { TBM_ENGINE_DECLARED: { description: 'Declared fact.' } },
      resolve: () => ({ TBM_ENGINE_UNDECLARED: 'bad' }),
    })

    expect(() => registry.collect(execution())).toThrow(/drifted-provider.*TBM_ENGINE_UNDECLARED/)
  })

  it('rejects non-string values returned by a contributor', () => {
    const registry = new ShellEnvRegistry(new Context(), { tbmHome: './test-tbm-home' })
    registry.register({
      name: 'wrong-value-type',
      variables: { TBM_ENGINE_STRING: { description: 'String fact.' } },
      resolve: () => ({ TBM_ENGINE_STRING: 42 }) as unknown as Record<'TBM_ENGINE_STRING', string>,
    })

    expect(() => registry.collect(execution())).toThrow(/wrong-value-type.*non-string.*TBM_ENGINE_STRING/)
  })

  it('removes an effect-scoped contributor when its plugin is disposed', async () => {
    const ctx = new Context()
    const registry = new ShellEnvRegistry(ctx, { tbmHome: './test-tbm-home' })
    const fiber = await ctx.plugin({
      inject: ['shellEnv'],
      apply(inner: Context) {
        inner.shellEnv.register({
          name: 'temporary',
          variables: { TBM_ENGINE_TEMPORARY: { description: 'Temporary fact.' } },
          resolve: () => ({ TBM_ENGINE_TEMPORARY: 'present' }),
        })
      },
    })

    expect(registry.collect(execution()).TBM_ENGINE_TEMPORARY).toBe('present')
    await fiber.dispose()
    expect(registry.collect(execution())).not.toHaveProperty('TBM_ENGINE_TEMPORARY')
  })

  it('returns an explicit contributor disposer', () => {
    const registry = new ShellEnvRegistry(new Context(), { tbmHome: './test-tbm-home' })
    const dispose = registry.register({
      name: 'explicit-disposal',
      variables: { TBM_ENGINE_EXPLICIT_DISPOSAL: { description: 'Explicitly disposed fact.' } },
      resolve: () => ({ TBM_ENGINE_EXPLICIT_DISPOSAL: 'present' }),
    })

    expect(registry.collect(execution()).TBM_ENGINE_EXPLICIT_DISPOSAL).toBe('present')
    dispose()
    expect(registry.collect(execution())).not.toHaveProperty('TBM_ENGINE_EXPLICIT_DISPOSAL')
  })

  it('the plugin registers the service with no contributors on load', async () => {
    const ctx = new Context()
    await ctx.plugin(BashEnvPlugin)
    expect(ctx.shellEnv).toBeInstanceOf(ShellEnvRegistry)
    expect(ctx.shellEnv.list()).toEqual([])
  })
})
