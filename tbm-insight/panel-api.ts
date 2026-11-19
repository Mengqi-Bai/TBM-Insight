/** Authenticated Web endpoints for the four TBM Insight business panels. */
import type { Context } from '@tbm-insight/cordis'
import type {} from '@tbm-insight/client-connection'
import { spawn } from 'node:child_process'
import { open, realpath } from 'node:fs/promises'
import { constants, setPriority } from 'node:os'
import { basename, extname, isAbsolute, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dataSources, PRODUCT_HOME, saveDataSources, type DataSources } from './data-sources.ts'

/** Stable Cordis plugin name. */
export const name = 'tbm-insight-panel-api'
/** Browser authentication and exact Fetch route registry. */
export const inject = ['connection']

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const KNOWLEDGE = join(ROOT, 'knowledge')
const OUTPUTS = process.env.TBM_INSIGHT_HOME ? join(PRODUCT_HOME, 'outputs') : join(ROOT, 'outputs')
const BRIDGE = join(ROOT, 'tools', 'tbm_panel_data.py')
const REQUEST_BYTES = 16 * 1024
const RESULT_BYTES = 8 * 1024 * 1024
const FILE_BYTES = 16 * 1024 * 1024
const CACHE_ENTRIES = 8

const fields = {
  progress: ['date', 'detail'],
  conditions: ['date', 'start_time', 'end_time', 'metrics', 'limit_metrics'],
  cutters: ['date', 'start_date', 'end_date', 'positions', 'reasons'],
  evidence: ['query', 'evidence_mode', 'limit', 'standard', 'clause', 'region', 'machine', 'domain', 'stage', 'geology', 'as_of'],
} as const

interface Config {
  python: string
  dataDir: string
  cutterSource: string
  timeoutMs: number
  metadataTimeoutMs: number
  cacheMs: number
  maxConcurrent: number
  maxQueued: number
}

class PanelError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function panelName(value: unknown): value is keyof typeof fields {
  return typeof value === 'string' && Object.hasOwn(fields, value)
}

function sourceMode(value: unknown): value is 'history' | 'simulation' {
  return value === 'history' || value === 'simulation'
}

function dateString(value: unknown): value is string {
  if (typeof value !== 'string' || !/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(value)
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
}

async function parameters(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
    throw new PanelError(415, 'unsupported_content_type', '面板查询需要 JSON 请求。')
  }
  if (Number(request.headers.get('content-length')) > REQUEST_BYTES) {
    throw new PanelError(413, 'request_too_large', '面板查询参数过长。')
  }
  const body = await request.arrayBuffer()
  if (body.byteLength > REQUEST_BYTES) throw new PanelError(413, 'request_too_large', '面板查询参数过长。')
  let value: unknown
  try {
    value = JSON.parse(new TextDecoder().decode(body))
  } catch {
    throw new PanelError(400, 'invalid_json', '面板查询参数不是有效的 JSON。')
  }
  if (!object(value) || !panelName(value.panel) || !sourceMode(value.mode)) {
    throw new PanelError(400, 'invalid_query', '请选择有效的面板和数据模式。')
  }
  const allowed = new Set(['panel', 'mode', ...fields[value.panel]])
  for (const [key, input] of Object.entries(value)) {
    if (!allowed.has(key)) throw new PanelError(400, 'unknown_parameter', `该面板不支持 ${key} 参数。`)
    if (['date', 'start_date', 'end_date', 'as_of'].includes(key) && !dateString(input)) {
      throw new PanelError(400, 'invalid_date', `${key} 应为有效日期 YYYY-MM-DD。`)
    }
    if (['metrics', 'limit_metrics', 'positions', 'reasons'].includes(key)) {
      const valid = (entry: unknown): boolean => key === 'positions'
        ? typeof entry === 'number' && Number.isSafeInteger(entry) && entry > 0
        : typeof entry === 'string' && entry.length > 0 && entry.length <= 200
      if (!Array.isArray(input) || input.length > 64 || !input.every(valid)) {
        throw new PanelError(400, 'invalid_parameter', `${key} 列表无效。`)
      }
    } else if (key === 'limit') {
      if (typeof input !== 'number' || !Number.isInteger(input) || input < 1 || input > 20) {
        throw new PanelError(400, 'invalid_limit', '检索条数应为 1 到 20。')
      }
    } else if (typeof input !== 'string' || input.length > (key === 'query' ? 2000 : 200)) {
      throw new PanelError(400, 'invalid_parameter', `${key} 参数无效。`)
    }
  }
  if (value.detail !== undefined && value.detail !== 'day' && value.detail !== 'week') {
    throw new PanelError(400, 'invalid_detail', '请选择按日或按周查询进度。')
  }
  if (value.panel === 'progress' && value.detail === 'week' && dateString(value.date)) {
    const start = new Date(value.date)
    start.setUTCDate(start.getUTCDate() - (start.getUTCDay() + 6) % 7)
    value.date = start.toISOString().slice(0, 10)
  }
  return value
}

function abortedQuery(): PanelError {
  return new PanelError(499, 'query_cancelled', '已取消面板查询。')
}

function timedOutQuery(): PanelError {
  return new PanelError(504, 'query_timeout', '面板查询超时。请缩小查询范围后重试。')
}

function queryPanel(config: Config, input: Record<string, unknown>, sources: DataSources, cancel: AbortSignal): Promise<Record<string, unknown>> {
  const deadline = AbortSignal.timeout(config.timeoutMs)
  const signal = AbortSignal.any([deadline, cancel])
  const args = ['-B', '-X', 'utf8', BRIDGE, '--data-dir', sources.dataDir || join(PRODUCT_HOME, 'unset-plc'),
    '--cutter-source', sources.cutterSource || join(PRODUCT_HOME, 'unset-cutter.xlsx'),
    '--knowledge-root', sources.knowledgeDir || KNOWLEDGE, '--output-dir', join(OUTPUTS, 'panels')]
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortedQuery())
      return
    }
    const child = spawn(config.python, args, { cwd: ROOT, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] })
    if (input.prepare === true && child.pid !== undefined) {
      try {
        setPriority(child.pid, constants.priority.PRIORITY_BELOW_NORMAL)
      } catch (_error) {
        // A worker can exit before its priority is adjusted.
      }
    }
    const chunks: Buffer[] = []
    let size = 0
    let processFailed = false
    let stopping = false
    const stop = (): void => {
      if (stopping) return
      stopping = true
      child.kill('SIGKILL')
    }
    const markFailure = (): void => { processFailed = true }
    signal.addEventListener('abort', stop, { once: true })
    child.on('error', markFailure)
    child.stdin.on('error', () => { markFailure(); stop() })
    child.stdout.on('data', (chunk: Buffer) => {
      size += chunk.byteLength
      if (size > RESULT_BYTES) stop()
      else chunks.push(chunk)
    })
    child.once('close', code => {
      signal.removeEventListener('abort', stop)
      if (deadline.aborted || cancel.aborted) {
        reject(deadline.aborted ? timedOutQuery() : abortedQuery())
        return
      }
      if (size > RESULT_BYTES) {
        reject(new PanelError(502, 'result_too_large', '查询结果过大，请缩小查询范围。'))
        return
      }
      if (processFailed || code !== 0) {
        reject(new PanelError(502, 'bridge_failed', '工程数据服务未完成查询。'))
        return
      }
      try {
        const result: unknown = JSON.parse(Buffer.concat(chunks, size).toString('utf8'))
        if (!object(result) || result.panel !== input.panel || result.mode !== input.mode || typeof result.status !== 'string') {
          throw new Error('Invalid panel response')
        }
        if (object(result.error)) {
          const status = result.status === 'invalid_arguments' ? 400 : 502
          const message = typeof result.error.message === 'string' ? result.error.message : '工程数据服务查询失败。'
          reject(new PanelError(status, result.status, message))
          return
        }
        resolve(result)
      } catch {
        reject(new PanelError(502, 'invalid_bridge_response', '工程数据服务返回了无效结果。'))
      }
    })
    child.stdin.end(JSON.stringify(input))
  })
}

type QueryResult = Record<string, unknown>

interface Waiter {
  signal: AbortSignal
  abort: () => void
  resolve: (result: QueryResult) => void
  reject: (error: unknown) => void
}

interface Task {
  key: string
  input: Record<string, unknown>
  sources: DataSources
  cancel: AbortController
  waiters: Set<Waiter>
}

/** Shares identical queries and keeps a process slot occupied until Python has closed. */
class PanelQueries {
  private readonly tasks = new Map<string, Task>()
  private readonly queued: Task[] = []
  private readonly running = new Set<Promise<void>>()
  private readonly cache = new Map<string, { result: QueryResult, expires: number }>()
  private closed = false

  constructor(private readonly config: Config) {}

  query(input: Record<string, unknown>, client: AbortSignal): Promise<QueryResult> {
    if (this.closed || client.aborted) return Promise.reject(abortedQuery())
    const sources = dataSources(this.config)
    const source = input.panel === 'evidence' ? sources.knowledgeDir : input.panel === 'cutters' ? sources.cutterSource : sources.dataDir
    if (input.panel !== 'evidence' && input.mode === 'history' && !source) return Promise.reject(
      new PanelError(409, 'source_not_configured', '请先在「设置 → 工程数据」配置数据源。'))
    const key = JSON.stringify([source, Object.entries(input).sort(([left], [right]) => left.localeCompare(right))])
    const entry = this.cache.get(key)
    if (entry !== undefined && entry.expires > Date.now()) return Promise.resolve(entry.result)
    this.cache.delete(key)
    let task = this.tasks.get(key)
    if (task === undefined) {
      if (this.queued.length >= this.config.maxQueued) {
        return Promise.reject(new PanelError(503, 'query_busy', '面板查询较多，请稍后重试。'))
      }
      task = { key, input, sources, cancel: new AbortController(), waiters: new Set() }
      this.tasks.set(key, task)
      this.queued.push(task)
    }
    return this.waitFor(task, client)
  }

  private waitFor(task: Task, client: AbortSignal): Promise<QueryResult> {
    const deadline = AbortSignal.timeout(this.config.timeoutMs)
    const signal = AbortSignal.any([deadline, client])
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        signal, resolve, reject,
        abort: () => {
          task.waiters.delete(waiter)
          reject(deadline.aborted ? timedOutQuery() : abortedQuery())
          if (task.waiters.size > 0) return
          this.tasks.delete(task.key)
          const index = this.queued.indexOf(task)
          if (index !== -1) this.queued.splice(index, 1)
          task.cancel.abort()
        },
      }
      task.waiters.add(waiter)
      signal.addEventListener('abort', waiter.abort, { once: true })
      this.pump()
    })
  }

  private pump(): void {
    while (!this.closed && this.running.size < this.config.maxConcurrent && this.queued.length > 0) {
      const task = this.queued.shift()
      if (task === undefined) return
      const work = queryPanel(this.config, task.input, task.sources, task.cancel.signal).then(result => {
        if (task.waiters.size > 0 && ['ok', 'evidence_found', 'insufficient_evidence', 'not_needed'].includes(String(result.status))) {
          this.cache.set(task.key, { result, expires: Date.now() + this.config.cacheMs })
          const first = this.cache.keys().next()
          if (this.cache.size > CACHE_ENTRIES && !first.done) this.cache.delete(first.value)
        }
        this.finish(task, waiter => waiter.resolve(result))
      }, error => this.finish(task, waiter => waiter.reject(error))).finally(() => {
        this.running.delete(work)
        this.pump()
      })
      this.running.add(work)
    }
  }

  private finish(task: Task, settle: (waiter: Waiter) => void): void {
    if (this.tasks.get(task.key) === task) this.tasks.delete(task.key)
    for (const waiter of task.waiters) {
      waiter.signal.removeEventListener('abort', waiter.abort)
      settle(waiter)
    }
    task.waiters.clear()
  }

  async close(): Promise<void> {
    this.closed = true
    for (const task of this.tasks.values()) {
      task.cancel.abort()
      this.finish(task, waiter => waiter.reject(abortedQuery()))
    }
    this.queued.length = 0
    this.cache.clear()
    await Promise.all(this.running)
  }
}

function below(root: string, path: string): boolean {
  const offset = relative(root, path)
  return offset !== '' && offset !== '..' && !offset.startsWith(`..${sep}`) && !isAbsolute(offset)
}

async function panelFile(request: Request): Promise<Response> {
  const path = new URL(request.url).searchParams.get('path')
  if (!path || path.length > 4096 || !isAbsolute(path) || path.includes('\0')) {
    throw new PanelError(400, 'invalid_file_path', '文件路径无效。')
  }
  const extension = extname(path).toLowerCase()
  const root = extension === '.html' || extension === '.png' ? OUTPUTS : join(dataSources().knowledgeDir || KNOWLEDGE, 'versions')
  if (!['.png', '.html', '.md', '.json'].includes(extension) || !below(root, path)) {
    throw new PanelError(404, 'file_not_found', '没有找到可打开的面板文件。')
  }
  try {
    const canonical = await realpath(path)
    if (!below(await realpath(root), canonical) || extname(canonical).toLowerCase() !== extension) {
      throw new PanelError(404, 'file_not_found', '没有找到可打开的面板文件。')
    }
    const file = await open(canonical, 'r')
    try {
      const stat = await file.stat()
      if (!stat.isFile()) throw new PanelError(404, 'file_not_found', '没有找到可打开的面板文件。')
      if (stat.size > FILE_BYTES) throw new PanelError(413, 'file_too_large', '面板文件超过下载大小限制。')
      const bytes = Buffer.alloc(stat.size)
      let offset = 0
      while (offset < bytes.length) {
        const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset)
        if (bytesRead === 0) throw new PanelError(409, 'file_changed', '文件正在更新，请重试。')
        offset += bytesRead
      }
      const headers = new Headers({ 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
      headers.set('content-type', extension === '.png' ? 'image/png' : 'text/plain; charset=utf-8')
      if (extension === '.html') {
        headers.set('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(basename(canonical))}`)
      }
      return new Response(bytes, { headers })
    } finally {
      await file.close()
    }
  } catch (error) {
    if (error instanceof PanelError) throw error
    throw new PanelError(404, 'file_not_found', '没有找到可打开的面板文件。')
  }
}

const json = (value: unknown, status = 200): Response => Response.json(value, {
  status, headers: { 'cache-control': 'no-store' },
})

function failure(error: unknown): Response {
  if (error instanceof PanelError) {
    return json({ status: 'error', error: { code: error.code, message: error.message } }, error.status)
  }
  return json({ status: 'error', error: { code: 'panel_failed', message: '面板请求处理失败。' } }, 500)
}

/**
 * Mount panel queries and restricted local output downloads on the owner-only API channel.
 * @param ctx - Cordis context with the browser connection registry.
 * @param config - local Python executable, source paths, and query budget.
 */
export function apply(ctx: Context, config: Config): void {
  if (!config.python || (config.dataDir && !isAbsolute(config.dataDir)) || (config.cutterSource && !isAbsolute(config.cutterSource))
    || ![config.timeoutMs, config.metadataTimeoutMs, config.cacheMs, config.maxConcurrent, config.maxQueued]
      .every(value => Number.isSafeInteger(value) && value > 0)) {
    throw new Error('Invalid TBM panel API configuration')
  }
  const queries = new PanelQueries(config)
  const metadata = new PanelQueries({ ...config, timeoutMs: config.metadataTimeoutMs, maxConcurrent: 1 })
  const preparation = new PanelQueries({ ...config, maxConcurrent: 1 })
  const preparationLifetime = new AbortController()
  const preparing = new Set<string>()
  ctx.effect(() => async () => {
    preparationLifetime.abort()
    await Promise.all([queries.close(), metadata.close(), preparation.close()])
  }, 'tbm-panel-api: stop queries')

  ctx.connection.fetch.register({
    path: '/api/tbm/data-sources', methods: ['GET', 'POST'], requestBody: 'buffered',
    fetch: async request => {
      if (request.method === 'GET') return json(dataSources(config))
      try {
        if (!request.headers.get('content-type')?.startsWith('application/json')) throw new Error('请使用 JSON 保存数据路径。')
        const raw = await request.text()
        if (raw.length > REQUEST_BYTES) throw new Error('数据路径过长。')
        return json(await saveDataSources(JSON.parse(raw)))
      } catch (error) {
        return json({ error: { message: error instanceof Error ? error.message : '无法保存数据源。' } }, 400)
      }
    },
  })

  ctx.connection.fetch.register({
    path: '/api/tbm/panels', methods: ['GET', 'POST'], requestBody: 'buffered',
    fetch: async request => {
      if (request.method === 'GET') return json({ status: 'ready', capability: 'tbm-panels' })
      try {
        const input = await parameters(request)
        const result = await queries.query(input, request.signal)
        if (input.panel === 'progress' && input.mode === 'history' && input.detail === 'week'
          && result.status === 'index_pending' && object(result.data) && object(result.data.window)) {
          const monday = result.data.window.start
          if (dateString(monday) && !preparing.has(monday)) {
            preparing.add(monday)
            const finished = (): void => { preparing.delete(monday) }
            void preparation.query({ ...input, date: monday, prepare: true }, preparationLifetime.signal).then(finished, finished)
          }
        }
        return json(result)
      } catch (error) {
        return failure(error)
      }
    },
  })

  ctx.connection.fetch.register({
    path: '/api/tbm/panel-options', methods: ['GET'], requestBody: 'buffered',
    fetch: async request => {
      try {
        const params = new URL(request.url).searchParams
        const panel = params.get('panel')
        const mode = params.get('mode')
        if (!panelName(panel) || !sourceMode(mode)) {
          throw new PanelError(400, 'invalid_query', '请选择有效的面板和数据模式。')
        }
        return json(await metadata.query({ panel, mode, metadata: true }, request.signal))
      } catch (error) {
        return failure(error)
      }
    },
  })

  ctx.connection.fetch.register({
    path: '/api/tbm/panel-file', methods: ['GET'], requestBody: 'buffered',
    fetch: async request => {
      try {
        return await panelFile(request)
      } catch (error) {
        return failure(error)
      }
    },
  })
}
