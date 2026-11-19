/** The standalone SDK-minimal bundle's complete declared Cordis tree. */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'
import { entryListSchema } from '@tbm-insight/cordis-plugin-include'

function packageName(specifier: string): string {
  return specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]!
}

describe('tbm-sdk-minimal bundle', () => {
  it('declares one standalone allowlisted tree with every row dependency', () => {
    const root = fileURLToPath(new URL('..', import.meta.url))
    const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>
      tbm?: { bundle?: { patch?: string } }
    }
    expect(manifest.tbm?.bundle?.patch).toBe('./cordis.patch.yml')
    const patches = yaml.load(
      readFileSync(resolve(root, manifest.tbm!.bundle!.patch!), 'utf8'),
      { schema: entryListSchema },
    ) as Array<{ insert?: Array<{ id?: string; inject?: string[]; name?: string; config?: Record<string, unknown>; disabled?: unknown }> }>
    expect(patches).toHaveLength(1)
    const rows = patches[0]?.insert ?? []
    expect(rows.map(row => [row.id, row.name])).toEqual([
      ['sdk-app-startup', '@tbm-insight/sdk-app'],
      ['sdk-jsonrpc-server', '@tbm-insight/sdk-jsonrpc-server'],
      ['deepseek-llm-api-extensions', '@tbm-insight/deepseek-llm-api-extensions'],
      ['session-log-deepseek', '@tbm-insight/session-log-deepseek'],
      ['plugin-package-inventory-deepseek', '@tbm-insight/plugin-package-inventory-deepseek'],
      ['llm-deepseek', '@tbm-insight/llm-deepseek-api-key'],
      ['sandbox', '@tbm-insight/sandbox-local'],
      ['filesystem', '@tbm-insight/fs-local'],
      ['attachment-local', '@tbm-insight/attachment-local'],
      ['tool-fs', '@tbm-insight/tool-fs'],
      ['working-directory', '@tbm-insight/working-directory'],
      ['tool-working-directory', '@tbm-insight/tool-working-directory'],
      ['session-projection', '@tbm-insight/session-projection'],
      ['token-meter', '@tbm-insight/token-meter'],
      ['compaction-basic', '@tbm-insight/compaction-basic'],
      ['image-offload', '@tbm-insight/compaction-image-offload'],
      ['sandbox-policy', '@tbm-insight/sandbox-policy'],
      ['subprocess', '@tbm-insight/subprocess-local'],
      ['pty', '@tbm-insight/terminal'],
      ['terminal-bash', '@tbm-insight/terminal-bash'],
      ['terminal-pwsh', '@tbm-insight/terminal-bash'],
      ['timer', '@tbm-insight/cordis-plugin-timer'],
      ['llm', '@tbm-insight/llm'],
      ['session', '@tbm-insight/session'],
      ['session-title', '@tbm-insight/session-title'],
      ['system-prompt', '@tbm-insight/system-prompt'],
      ['tools', '@tbm-insight/tools'],
      ['tool-executor-native', '@tbm-insight/tool-executor-native'],
      ['mcp-resources', '@tbm-insight/mcp-resources'],
      ['agent', '@tbm-insight/agent'],
      ['llm-retry', '@tbm-insight/llm-retry'],
      ['jobs', '@tbm-insight/jobs-local'],
      ['agent-loop', '@tbm-insight/agent-loop'],
      ['persistent-bash', '@tbm-insight/tool-bash-persistent'],
      ['persistent-pwsh', '@tbm-insight/tool-pwsh-persistent'],
      ['sessions', '@tbm-insight/session-persistence-jsonl'],
      ['session-checkpoint-policy', '@tbm-insight/session-checkpoint-policy'],
    ])
    expect(rows.find(row => row.id === 'sdk-app-startup')?.config).toEqual({ profile: 'sdk-minimal' })
    expect(rows.find(row => row.id === 'sdk-jsonrpc-server')).toMatchObject({
      inject: ['sdkAppStartup', 'loader'],
      config: { maxTokensAsSuccess: false },
    })
    expect(rows.find(row => row.id === 'llm-deepseek')?.config).toEqual({
      apiKeyEnv: 'DEEPSEEK_API_KEY',
      defaultContextWindow: { __jsExpr: 'Number(process.env.TBM_ENGINE_CONTEXT_WINDOW ?? 1000000)' },
      streamIdleTimeoutMs: 172800000,
    })
    expect(rows.find(row => row.id === 'system-prompt')?.config).toEqual({
      includeHarnessIdentity: false,
      includeRuntimeContext: false,
      personaPrefix: { __jsExpr: "process.env.TBM_ENGINE_SYSTEM_PROMPT ?? 'You are a helpful software engineer assistant.'" },
    })
    expect(rows.find(row => row.id === 'agent-loop')?.config).toEqual({ agents: [] })
    expect(rows.find(row => row.id === 'tool-fs')?.config).toEqual({ read: false, readImage: true, write: false, edit: false })
    expect(rows.find(row => row.id === 'compaction-basic')?.config).toBeUndefined()
    expect(rows.find(row => row.id === 'terminal-bash')).toMatchObject({
      disabled: { __jsExpr: "process.platform === 'win32'" },
    })
    expect(rows.find(row => row.id === 'terminal-pwsh')).toMatchObject({
      disabled: { __jsExpr: "process.platform !== 'win32'" },
      config: { shellDialect: 'pwsh', timeoutMs: 300000 },
    })
    expect(Object.keys(manifest.dependencies ?? {}).sort()).toEqual(
      [...new Set(rows.map(row => row.name).filter((name): name is string => name !== undefined).map(packageName))].sort(),
    )
  })
})
