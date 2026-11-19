import type { Context } from '@tbm-insight/cordis'
import type {} from '@tbm-insight/agent-default-model'
import { BlockAssembler, createAssistantMessage, createMessage, type GenerateOptions, type ImageBlock, type LlmFailure, type RequestMessage } from '@tbm-insight/llm'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

const MAX_REQUEST = 12 * 1024 * 1024
const MAX_OUTPUT = 8 * 1024 * 1024
const MAX_ACTIVE = 4

export interface ModelActivity {
  phase: 'waiting' | 'reasoning' | 'text' | 'received' | 'failed' | 'aborted'
  request: number
  startedAt: number
  lastContentAt?: number
  endedAt?: number
  errorCode?: string
  error?: string
}

export type ModelActivityObserver = (activity: ModelActivity) => void

export function researchModelSelection(ctx: Context) {
  return ctx.agentDefaultModel.currentSelection()
}

type ModelSelection = ReturnType<typeof researchModelSelection>

class RequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message) }
}

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function send(response: ServerResponse, status: number, value: unknown) {
  if (response.destroyed || response.writableEnded) return
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(value))
}

async function jsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (request.headers['content-type']?.split(';')[0] !== 'application/json') {
    throw new RequestError(415, 'invalid_request', 'Expected a JSON model request.')
  }
  if (Number(request.headers['content-length']) > MAX_REQUEST) throw new RequestError(413, 'invalid_request', 'Model request is too large.')
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    if (!Buffer.isBuffer(chunk)) throw new RequestError(400, 'invalid_request', 'Invalid model request.')
    size += chunk.length
    if (size > MAX_REQUEST) {
      request.resume()
      throw new RequestError(413, 'invalid_request', 'Model request is too large.')
    }
    chunks.push(chunk)
  }
  try { return object(JSON.parse(Buffer.concat(chunks).toString('utf8'))) } catch {
    throw new RequestError(400, 'invalid_request', 'Invalid model request JSON.')
  }
}

function completionOptions(body: Record<string, unknown>, selection: ModelSelection, signal: AbortSignal, images: ImageBlock[]): GenerateOptions {
  if (body.model !== selection.model || !Array.isArray(body.messages) || !body.messages.length || body.messages.length > 300
    || body.stream === true || body.tools !== undefined || body.tool_choice !== undefined) {
    throw new RequestError(400, 'invalid_request', 'Expected a text completion for the selected TBM Insight model.')
  }
  const messages: RequestMessage[] = []
  const leadingSystem: string[] = []
  for (const entry of body.messages) {
    const value = object(entry)
    const { role, content } = value
    if (typeof content !== 'string') throw new RequestError(400, 'invalid_request', 'Expected text message content.')
    const blocks = [{ type: 'text' as const, text: content }]
    if (role === 'system' && !messages.length) leadingSystem.push(content)
    else if (role === 'system') messages.push(createMessage({ role, content: blocks, source: { kind: 'system-prompt' } }))
    else if (role === 'user') messages.push({ role, content: blocks })
    else if (role === 'assistant') messages.push(createAssistantMessage({ content: blocks, source: { provider: selection.provider, model: selection.model } }))
    else throw new RequestError(400, 'invalid_request', 'Unsupported model message role.')
  }
  const latestUser = messages.findLast(message => message.role === 'user')
  if (latestUser?.role === 'user' && images.length) {
    messages[messages.lastIndexOf(latestUser)] = { role: 'user', content: [...latestUser.content, ...images] }
  }
  if (object(body.response_format).type === 'json_object') leadingSystem.push('Return one valid JSON object. Omit Markdown fences and any text outside the JSON object.')
  const temperature = typeof body.temperature === 'number' && body.temperature >= 0 && body.temperature <= 2 ? body.temperature : undefined
  return { ...selection, messages, signal, omitOutputTokenLimit: true, waitForModel: true,
    ...(leadingSystem.length ? { system: leadingSystem.join('\n\n') } : {}), ...(temperature === undefined ? {} : { temperature }) }
}

function modelError(failure: LlmFailure): RequestError {
  // Some transports retain the HTTP status only at the start of the error text.
  const reported = /^(?:HTTP\s+(?:status\s+)?)?([45]\d{2})\b/iu.exec(failure.message.trim())?.[1]
  const status = failure.status ?? (reported ? Number(reported) : undefined)
  if (status === 401 || status === 403 || ['AUTH', 'INVALID_CREDENTIAL', 'MISSING_CREDENTIAL',
    'ACCOUNT_SIGN_IN_REQUIRED', 'NO_ADAPTER', 'UNKNOWN_MODEL', 'UNSUPPORTED_REASONING_EFFORT'].includes(failure.code)) {
    return new RequestError(422, 'model_unavailable', '无法使用所选模型，请在「设置 → 模型」核对提供商、模型名称和凭据。')
  }
  if (status === 429 || failure.code === 'RATE_LIMIT') return new RequestError(429, 'rate_limit', '所选模型服务限流，请稍后恢复研究。')
  if (failure.code === 'TIMEOUT' || status === 408 || status === 504) {
    return new RequestError(504, 'model_timeout', '模型服务或连接超时。可以从当前阶段重试。')
  }
  if (failure.code === 'UNSUPPORTED_CONTENT') return new RequestError(422, 'unsupported_model_content', '当前模型无法处理这条消息中的图片或内容。')
  if (failure.code === 'CONTEXT_WINDOW_EXCEEDED' || status === 413) {
    return new RequestError(422, 'model_context_limit', '请求内容超过模型可处理的长度。')
  }
  return new RequestError(502, 'model_request_failed', status === undefined
    ? `模型请求中断（${/^[A-Z_\d]+$/u.test(failure.code) ? failure.code : '请求失败'}）。`
    : `模型服务返回 HTTP ${status}。可以从当前阶段重试。`)
}

async function assembleReply(ctx: Context, options: GenerateOptions, onContent: (phase: 'text' | 'reasoning') => void) {
  const assembler = new BlockAssembler()
  let size = 0
  for await (const chunk of ctx.llm.stream(options)) {
    if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
      size += chunk.text.length
      if (chunk.text) onContent(chunk.type === 'text-delta' ? 'text' : 'reasoning')
    }
    if (chunk.type === 'block-end' && (chunk.block.type === 'text' || chunk.block.type === 'reasoning')) {
      size += chunk.block.text.length
      if (chunk.block.text) onContent(chunk.block.type)
    }
    if (size > MAX_OUTPUT) throw new RequestError(502, 'model_request_failed', '模型输出超出可读取范围。')
    assembler.push(chunk)
  }
  const finish = assembler.finish
  if (finish.kind === 'error' || finish.kind === 'aborted') throw modelError(finish.failure)
  const content = assembler.blocks().flatMap(block => block.type === 'text' ? [block.text] : []).join('')
  if (!content.trim()) {
    if (finish.kind === 'max-tokens') throw new RequestError(422, 'empty_at_output_limit', '模型已达到输出上限，尚未生成研究正文。')
    throw new RequestError(502, 'empty_model_response', '模型返回了空正文，本阶段未生成成果。')
  }
  const tokenUsage = assembler.usage
  const input = tokenUsage ? tokenUsage.inputTokens + (tokenUsage.cacheReadTokens ?? 0) + (tokenUsage.cacheWriteTokens ?? 0) : 0
  return {
    id: `chatcmpl-${randomUUID()}`, object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: options.model,
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: finish.kind === 'max-tokens' ? 'length' : 'stop' }],
    ...(tokenUsage ? { usage: { prompt_tokens: input, completion_tokens: tokenUsage.outputTokens,
      total_tokens: tokenUsage.totalTokens ?? input + tokenUsage.outputTokens } } : {}),
  }
}

async function complete(ctx: Context, options: GenerateOptions, request: number, observe?: ModelActivityObserver) {
  const activity: ModelActivity = { phase: 'waiting', request, startedAt: Date.now() }
  let publishedAt = activity.startedAt
  observe?.({ ...activity })
  try {
    const reply = await assembleReply(ctx, options, content => {
      if (!observe || options.signal?.aborted) return
      const now = Date.now()
      const phase = activity.phase === 'text' ? 'text' : content
      const changed = activity.phase !== phase
      activity.phase = phase
      activity.lastContentAt = now
      if (changed || now - publishedAt >= 15_000) {
        publishedAt = now
        observe({ ...activity })
      }
    })
    options.signal?.throwIfAborted()
    observe?.({ ...activity, phase: 'received', endedAt: Date.now() })
    return reply
  } catch (error) {
    const failure = error instanceof RequestError ? error
      : new RequestError(502, 'model_request_failed', '模型连接中断。可以从当前阶段重试。')
    const endedAt = Date.now()
    if (options.signal?.aborted) observe?.({ ...activity, phase: 'aborted', endedAt })
    else observe?.({ ...activity, phase: 'failed', endedAt, errorCode: failure.code, error: failure.message })
    throw failure
  }
}

export async function discussResearch(ctx: Context, selection: ModelSelection, system: string, input: string, signal: AbortSignal,
  images: ImageBlock[] = [], observe?: ModelActivityObserver): Promise<string> {
  try {
    const reply = await complete(ctx, { ...selection, system, signal, omitOutputTokenLimit: true, waitForModel: true,
      messages: [{ role: 'user', content: [{ type: 'text', text: input }, ...images] }] }, 1, observe)
    return reply.choices[0]?.message.content ?? ''
  } catch (error) {
    if (error instanceof RequestError) throw new Error(error.message)
    throw new Error('科研助手暂未收到模型回复，请重试。')
  }
}

/** Adapt the bundled engine's OpenAI text transport to the selected model provider. */
export async function startResearchModelBridge(ctx: Context, selection: ModelSelection, signal: AbortSignal,
  images: ImageBlock[] = [], observe?: ModelActivityObserver) {
  signal.throwIfAborted()
  if (!selection.model.trim() || !selection.provider.trim()) throw new Error('请先在「设置 → 模型」选择科研任务使用的模型。')
  const apiKey = randomBytes(32).toString('hex')
  const authorization = Buffer.from(`Bearer ${apiKey}`)
  let active = 0
  let sequence = 0
  let lastFailure: { code: string; message: string } | undefined
  const lifetime = new AbortController()
  const server = createServer({ requestTimeout: 0, headersTimeout: 10_000 }, (request, response) => {
    const token = Buffer.from(request.headers.authorization ?? '')
    if (request.url !== '/v1/chat/completions' || request.method !== 'POST'
      || token.length !== authorization.length || !timingSafeEqual(token, authorization)) {
      request.resume()
      send(response, 404, { error: { message: 'Unknown model route.' } })
      return
    }
    if (active >= MAX_ACTIVE) {
      request.resume()
      send(response, 429, { error: { message: 'Research model is processing other requests.', type: 'rate_limit' } })
      return
    }
    active += 1
    const disconnected = new AbortController()
    response.once('close', () => { if (!response.writableFinished) disconnected.abort() })
    const requestSignal = AbortSignal.any([signal, lifetime.signal, disconnected.signal])
    void (async () => {
      try {
        const options = completionOptions(await jsonBody(request), selection, requestSignal, images)
        const ordinal = ++sequence
        const value = await complete(ctx, options, ordinal, observe)
        lastFailure = undefined
        send(response, 200, value)
      } catch (error) {
        const failure = error instanceof RequestError ? error : new RequestError(502, 'model_request_failed', '科研模型连接中断，可恢复当前阶段重试。')
        lastFailure = { code: failure.code, message: failure.message }
        send(response, failure.status, { error: { message: failure.message, type: failure.code } })
      } finally { active -= 1 }
    })()
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve() })
  })
  const address = server.address() as AddressInfo
  let closing: Promise<void> | undefined
  const close = () => {
    if (closing) return closing
    signal.removeEventListener('abort', close)
    lifetime.abort()
    closing = new Promise<void>((resolve) => {
      server.close(() => { resolve() })
      server.closeAllConnections()
    })
    return closing
  }
  signal.addEventListener('abort', close, { once: true })
  if (signal.aborted) { await close(); signal.throwIfAborted() }
  return { baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey, model: selection.model, close, failure: () => lastFailure }
}
