import { executeToolFixture } from '@tbm-insight/tool-testkit'
import * as NativeToolExecutor from '@tbm-insight/tool-executor-native'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { unsupportedModel, provideWorkingDirectoryFixture, unsupportedInbox } from '@tbm-insight/agent-loop-testkit'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@tbm-insight/cordis'
import Loader from '@tbm-insight/cordis-plugin-loader'
import Include from '@tbm-insight/cordis-plugin-include'
import { ToolCallId } from '@tbm-insight/llm'
import { Session, SessionId } from '@tbm-insight/session'
import AgentRegistry from '@tbm-insight/agent'
import type { Agent } from '@tbm-insight/agent'
import SystemPrompt from '@tbm-insight/system-prompt'
import ToolRuntime from '@tbm-insight/tools'
import TerminalSessionService from '@tbm-insight/terminal'
import SandboxProvider from '@tbm-insight/sandbox'
import type { ConfinedArgv, SandboxPolicy } from '@tbm-insight/sandbox'
import SandboxPolicyService from '@tbm-insight/sandbox-policy'
import SessionProjectionRegistry from '@tbm-insight/session-projection'
import LocalSubprocessRuntime from '@tbm-insight/subprocess-local'
import * as TerminalLocal from '@tbm-insight/terminal-bash'
import * as ToolPty from '@tbm-insight/tool-terminal'

let root: string | undefined
let context: Context | undefined

afterEach(async () => {
  await context?.fiber.dispose()
  context = undefined
  if (root !== undefined) await rm(root, { recursive: true, force: true })
  root = undefined
})

class PassthroughSandbox extends SandboxProvider {
  async confine(argv: readonly string[], _policy: SandboxPolicy): Promise<ConfinedArgv> {
    return { argv: [...argv], enforcement: 'full', denialSignatures: [], runnerFailureRules: [] }
  }
}

async function agent(ctx: Context): Promise<Agent> {
  const scope = ctx.plugin(() => {})
  const id = SessionId('pty-loader-agent')
  const session = Session.create(id)
  const value: Agent = {
    id, options: {}, session, model: unsupportedModel(),
    inbox: unsupportedInbox(),
    status: 'idle',
    ctx: scope.ctx,
    send: () => {},
    followup: () => {}, steer: () => {}, inject: () => {}, cancel() {},
    runMaintenance: job => job(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
  await ctx.agents.register(value)
  return value
}

function resultText(result: { content: { type: string; text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

const suite = process.platform === 'linux' || process.platform === 'darwin' ? describe : describe.skip

suite('terminal real Loader composition through cordis.yml', () => {
  it('boots cordis.yml and preserves shell state across real tool calls', async () => {
    root = await mkdtemp(join(tmpdir(), 'tbm-pty-loader-'))
    const configPath = join(root, 'cordis.yml')
    await writeFile(configPath, [
      "- name: '@tbm-insight/agent'",
      "- name: '@tbm-insight/system-prompt'",
      "- name: '@tbm-insight/tools'",
      "- name: '@tbm-insight/tool-executor-native'",
      "- name: '@tbm-insight/terminal'",
      "- name: '@tbm-insight/test-sandbox'",
      "- name: '@tbm-insight/session-projection'",
      "- name: '@tbm-insight/sandbox-policy'",
      '  config:',
      '    mode: danger-full-access',
      `    workspaceRoot: ${JSON.stringify(root)}`,
      "- name: '@tbm-insight/subprocess-local'",
      "- name: '@tbm-insight/terminal-bash'",
      '  config:',
      '    pollIntervalMs: 10',
      '    exactProbeAfterMs: 20',
      '    idleSilenceMs: 250',
      '    handoffGraceMs: 250',
      '    timeoutMs: 2000',
      '    disposeGraceMs: 500',
      "- name: '@tbm-insight/tool-terminal'",
      '',
    ].join('\n'))

    context = new Context()

    provideWorkingDirectoryFixture(context)
    context.baseUrl = pathToFileURL(root).href + '/'
    await context.plugin(Loader)
    context.loader.builtins.include = Include
    const modules = new Map<string, unknown>([
      ['@tbm-insight/agent', AgentRegistry],
      ['@tbm-insight/system-prompt', SystemPrompt],
      ['@tbm-insight/tools', ToolRuntime],
      ['@tbm-insight/tool-executor-native', NativeToolExecutor],
      ['@tbm-insight/terminal', TerminalSessionService],
      ['@tbm-insight/test-sandbox', PassthroughSandbox],
      ['@tbm-insight/session-projection', SessionProjectionRegistry],
      ['@tbm-insight/sandbox-policy', SandboxPolicyService],
      ['@tbm-insight/subprocess-local', LocalSubprocessRuntime],
      ['@tbm-insight/terminal-bash', TerminalLocal],
      ['@tbm-insight/tool-terminal', ToolPty],
    ])
    context.loader.internal = {
      version: 'v2',
      async import(specifier: string) {
        if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
        return modules.get(specifier)
      },
    } as unknown as NonNullable<typeof context.loader.internal>
    await context.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
    await context.loader.await()

    const owner = await agent(context)
    const signal = new AbortController().signal
    const spawn = await executeToolFixture(context, {
      signal, callId: ToolCallId('spawn'), name: 'terminal_open', arguments: { type: 'shell', name: 'main', cwd: root }, agent: owner,
    })
    expect(resultText(spawn)).toContain('started terminal session pty-1 (main)')

    await executeToolFixture(context, {
      signal, callId: ToolCallId('state'), name: 'terminal_send', arguments: { sessionId: 'pty-1', text: 'export KEEP=loader; cd /' }, agent: owner,
    })
    const read = await executeToolFixture(context, {
      signal, callId: ToolCallId('read'), name: 'terminal_send', arguments: { sessionId: 'pty-1', text: 'printf "cwd=%s keep=%s\\n" "$PWD" "$KEEP"' }, agent: owner,
    })
    expect(resultText(read)).toContain('cwd=/ keep=loader')
    expect(context.terminals.list(owner)).toHaveLength(1)
  }, 15_000)
})
