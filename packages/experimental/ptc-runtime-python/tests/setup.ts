import { Context } from '@tbm-insight/cordis'
import Sandbox from '@tbm-insight/sandbox-local'
import SandboxPolicy from '@tbm-insight/sandbox-policy'
import SessionProjections from '@tbm-insight/session-projection'
import { onTestFinished } from 'vitest'
import type { SandboxMode } from '@tbm-insight/sandbox'

/** Mount the Python runtime's policy and confinement providers with owned teardown. */
export async function createRuntimeContext(policy: { mode?: SandboxMode; workspaceRoot?: string } = {}): Promise<Context> {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  await ctx.plugin(Sandbox, {})
  await ctx.plugin(SessionProjections)
  await ctx.plugin(SandboxPolicy, { mode: 'danger-full-access', ...policy })
  return ctx
}
