/** Built package smoke: headless consumers must not import the browser implementation. */
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'

const guard = registerHooks({
  resolve(specifier, context, next) {
    assert(!/^(?:react(?:-dom)?(?:\/|$)|@tbm-insight\/client-)/.test(specifier), `Headless import reached ${specifier}`)
    const result = next(specifier, context)
    assert(!/\/cua\/lib\/(?:client(?:\/|\.)|types\/client\/)/.test(result.url), `Headless import reached ${result.url}`)
    return result
  },
})
const { Context } = await import('@tbm-insight/cordis')
const host = await import('@tbm-insight/cua')
const { createCuaApi } = await import('@tbm-insight/cua/api')
const { connectCua } = await import('@tbm-insight/cua/bridge')
const { NativeClient } = await import('@tbm-insight/cua/native-client')
const { Request } = await import('@tbm-insight/cua/protocol')
for (const callable of [host.apply, host.installCua, host.CuaAccess, createCuaApi, connectCua, NativeClient]) assert.equal(typeof callable, 'function')
assert.equal(Request.parse({ method: 'getCapabilities', params: {} }).method, 'getCapabilities')
const ctx = new Context()
try { await ctx.plugin(host); assert.equal(ctx.get('cuaAccess'), undefined) }
finally { await ctx.fiber.dispose() }
guard.deregister()
const remote = await import('@tbm-insight/cua/remote')
assert.equal(remote.default.package, '@tbm-insight/cua')
assert.equal(remote.default.descriptors.length, 9)
process.stdout.write('headless exports and generated Remote passed\n')
