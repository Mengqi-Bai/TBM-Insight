/** Owner-only HTTP API for local TBM research projects and results. */
import type { Context } from '@tbm-insight/cordis'
import { dataSources } from '../data-sources.ts'
import type {} from '@tbm-insight/client-connection'
import type {} from '@tbm-insight/attachment'
import { randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { Readable } from 'node:stream'
import { lstat, mkdir, open, readdir, readFile, realpath, rm, rmdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { JSON_SCHEMA, load } from 'js-yaml'
import type {} from '@tbm-insight/agent-default-model'
import { searchStrategyReview } from './research-search-review.ts'
import { reviewDataFiles, stageOfReview, stageReview } from './research-stage-review.ts'
import { readResearchUpload, researchUploadInputs, saveResearchUpload } from './research-uploads.ts'
import { ResearchError, ResearchStore, type ProjectHeader, type ResearchMessage, type ResearchRun, type ReviewDocument } from './research-store.ts'
import { ResearchAgentSessions, researchDocument } from './research-agent.ts'

/** Stable Cordis plugin identity for the research overlay. */
export const name = 'tbm-insight-research-api'
/** Reuse the browser connection's authentication and origin validation. */
export const inject = ['connection', 'llm', 'agentDefaultModel', 'attachments', 'agents', 'agentPresets', 'sessionPersistence', 'tools', 'systemPrompt']

const ROOT = fileURLToPath(new URL('.', import.meta.url))
const BODY_BYTES = 48 * 1024
const ARTIFACT_BYTES = 25 * 1024 * 1024
const ID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/
const OUT_OF_SCOPE = /漏洞利用|入侵|植入后门|攻击复现|生物武器|病原体工程|武器化|exploit|malware|pathogen/iu
const STAGE_CATALOG = [
  ['TOPIC_INIT', '主题初始化'], ['PROBLEM_DECOMPOSE', '问题分解'], ['SEARCH_STRATEGY', '检索策略'],
  ['LITERATURE_COLLECT', '文献收集'], ['LITERATURE_SCREEN', '文献筛选'], ['KNOWLEDGE_EXTRACT', '知识提取'],
  ['SYNTHESIS', '证据综合'], ['HYPOTHESIS_GEN', '形成假设'], ['EXPERIMENT_DESIGN', '实验设计'],
  ['CODE_GENERATION', '生成实验代码'], ['RESOURCE_PLANNING', '资源规划'], ['EXPERIMENT_RUN', '执行实验'],
  ['ITERATIVE_REFINE', '迭代优化'], ['RESULT_ANALYSIS', '结果分析'], ['RESEARCH_DECISION', '研究决策'],
  ['PAPER_OUTLINE', '论文提纲'], ['PAPER_DRAFT', '论文初稿'], ['PEER_REVIEW', '同行评议'],
  ['PAPER_REVISION', '论文修订'], ['QUALITY_GATE', '质量审核'], ['KNOWLEDGE_ARCHIVE', '知识归档'],
  ['EXPORT_PUBLISH', '成果导出'], ['CITATION_VERIFY', '引文核验'],
] as const
const REVIEW_METADATA = new Set(['decision.json', 'stage_health.json', 'hardware_profile.json', 'hitl_guidance.md'])
const MEDIA: Record<string, { type: string; kind: string }> = {
  '.md': { type: 'text/plain; charset=utf-8', kind: 'markdown' },
  '.txt': { type: 'text/plain; charset=utf-8', kind: 'text' },
  '.log': { type: 'text/plain; charset=utf-8', kind: 'text' },
  '.csv': { type: 'text/csv; charset=utf-8', kind: 'csv' },
  '.tsv': { type: 'text/tab-separated-values; charset=utf-8', kind: 'csv' },
  '.json': { type: 'application/json; charset=utf-8', kind: 'json' },
  '.jsonl': { type: 'text/plain; charset=utf-8', kind: 'text' },
  '.yaml': { type: 'text/plain; charset=utf-8', kind: 'text' },
  '.yml': { type: 'text/plain; charset=utf-8', kind: 'text' },
  '.py': { type: 'text/plain; charset=utf-8', kind: 'text' },
  '.tex': { type: 'text/plain; charset=utf-8', kind: 'text' },
  '.bib': { type: 'text/plain; charset=utf-8', kind: 'text' },
  '.png': { type: 'image/png', kind: 'image' },
  '.jpg': { type: 'image/jpeg', kind: 'image' },
  '.jpeg': { type: 'image/jpeg', kind: 'image' },
  '.webp': { type: 'image/webp', kind: 'image' },
  '.pdf': { type: 'application/pdf', kind: 'pdf' },
  '.zip': { type: 'application/zip', kind: 'archive' },
  '.html': { type: 'text/plain; charset=utf-8', kind: 'html' },
}

interface Config {
  python: string
  dataDir: string
  projectsDir?: string
  arcPython?: string
}

interface Artifact { path: string; name: string; size: number; kind: string }
function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function requiredText(value: unknown, label: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) {
    throw new ResearchError(400, 'invalid_parameter', `${label}无效。`)
  }
  return value.trim()
}

function requiredId(value: unknown): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new ResearchError(400, 'invalid_id', '项目或任务编号无效。')
  return value
}

function inside(root: string, target: string): boolean {
  const offset = relative(root, target)
  return offset !== '' && offset !== '..' && !offset.startsWith(`..${sep}`) && !isAbsolute(offset)
}

function samePath(left: string, right: string): boolean { return relative(left, right) === '' }

async function optionalRealpath(path: string): Promise<string | undefined> {
  try { return await realpath(path) } catch (error) {
    if (object(error) && error.code === 'ENOENT') return undefined
    throw error
  }
}

function runPath(projects: string, run: ResearchRun): string {
  return join(projects, run.projectId, 'runs', run.id)
}

const PROJECT_MARKER = '.tbm-research-project'

function localAbsolutePath(path: string): boolean {
  return isAbsolute(path) && (process.platform !== 'win32' || /^[A-Za-z]:[/\\]/u.test(path))
}

async function projectStorage(projects: string, store: ResearchStore, projectId: string): Promise<string> {
  const parent = store.storageParent(projectId)
  if (parent === undefined) return projects
  const folder = join(parent, requiredId(projectId))
  await checkedRunRoot(parent, folder)
  const mark = join(folder, PROJECT_MARKER)
  const file = await lstat(mark)
  if (!file.isFile() || file.size > 100 || (await readFile(mark, 'utf8')).trim() !== projectId) {
    throw new ResearchError(409, 'unsafe_project_path', '科研项目文件夹无法验证。')
  }
  return parent
}

async function createProject(store: ResearchStore, config: Config, projects: string, input: Record<string, unknown>) {
  const name = requiredText(input.name, '项目名称', 100)
  const id = randomUUID()
  if (input.directory === undefined || input.directory === '') return store.create(name, id)
  const selected = requiredText(input.directory, '保存位置', 1200)
  if (!localAbsolutePath(selected)) {
    throw new ResearchError(400, 'invalid_directory', '请选择本机的一个文件夹。')
  }
  const parent = await realpath(selected).catch(() => undefined)
  const configuredData = dataSources({ dataDir: config.dataDir }).dataDir
  const originalData = configuredData && (await optionalRealpath(configuredData) ?? configuredData)
  if (parent === undefined || !samePath(parent, selected) || !(await lstat(parent)).isDirectory()
    || (originalData && (samePath(parent, originalData) || inside(originalData, parent)))
    || (inside(projects, parent)) || relative(dirname(parent), parent).startsWith('.')) {
    throw new ResearchError(400, 'invalid_directory', '请选择可写的普通目录，原始数据和其他科研项目目录不能作为保存位置。')
  }
  if (samePath(parent, projects)) return store.create(name, id)
  const folder = join(parent, id)
  try { await mkdir(folder) } catch { throw new ResearchError(400, 'invalid_directory', '无法在所选位置创建科研项目文件夹。') }
  const marker = join(folder, PROJECT_MARKER)
  try {
    await checkedRunRoot(parent, folder)
    await writeFile(marker, `${id}\n`, { flag: 'wx' })
    return store.create(name, id, parent)
  } catch (error) {
    await unlink(marker).catch(() => {})
    await rmdir(folder).catch(() => {})
    throw error
  }
}

async function checkedRunRoot(projects: string, folder: string): Promise<void> {
  if (!inside(projects, folder) || relative(folder, await realpath(folder)) !== '') {
    throw new ResearchError(409, 'unsafe_project_path', '科研目录无法安全打开。')
  }
}

function artifactMedia(path: string) { return MEDIA[extname(path).toLowerCase()] }

function artifactPath(value: unknown): string {
  const path = requiredText(value, '成果路径', 600)
  if (path.includes('\\') || path.includes(':') || path.split('/').some(part => !part || part.startsWith('.'))) {
    throw new ResearchError(400, 'invalid_artifact_path', '成果路径无效。')
  }
  return path
}

function visibleArtifact(path: string): boolean {
  return !/(?:^|\/)(?:run-status\.json|heartbeat\.json|checkpoint\.json|config[^/]*)(?:$|\/)/i.test(path)
}

function readableArtifact(run: ResearchRun, path: string): boolean {
  if (/^reviews\/[0-9a-f-]{36}\/\d+(?:\.[a-z\d]+|\/[^/]+)$/i.test(path)) return true
  if (!visibleArtifact(path) || path.startsWith('superseded/') || run.status === 'queued') return false
  if (run.status !== 'running') return true
  const match = /^stage-(\d{2})\//.exec(path)
  return match !== null && Boolean(run.stages?.some(stage => stage.number === Number(match[1]) && stage.status === 'succeeded'))
}

async function artifacts(projects: string, run: ResearchRun, stageDirectory?: string): Promise<Artifact[]> {
  if (run.status === 'queued' || (run.status === 'running' && !run.stages?.length)) return []
  const folder = join(runPath(projects, run), 'artifacts', stageDirectory ?? '')
  try { await checkedRunRoot(projects, folder) } catch (error) {
    if (object(error) && error.code === 'ENOENT') return []
    throw error
  }
  const result: Artifact[] = []
  const walk = async (parent: string, prefix: string, depth: number): Promise<void> => {
    if (depth > 5) return
    const files = await readdir(parent, { withFileTypes: true })
    files.sort((left, right) => left.name.localeCompare(right.name))
    for (const file of files) {
      if (result.length >= 200) return
      if (file.name.startsWith('.') || file.isSymbolicLink()) continue
      if (!prefix && (file.name === 'reviews' || file.name === 'superseded')) continue
      const path = prefix + file.name
      if (!visibleArtifact(path)) continue
      if (file.isDirectory()) await walk(join(parent, file.name), path + '/', depth + 1)
      const media = artifactMedia(path)
      if (file.isFile() && media && readableArtifact(run, path)) {
        const stat = await lstat(join(parent, file.name))
        if (stat.isFile() && stat.size <= ARTIFACT_BYTES) result.push({ path, name: file.name, size: stat.size, kind: media.kind })
      }
    }
  }
  await walk(folder, stageDirectory ? stageDirectory + '/' : '', 0)
  return result
}

function publicRun(run: ResearchRun) {
  const { projectId: _projectId, resume: _resume, decision: _decision, revision: _revision, queuedRevision: _queued, submission: _submission,
    additionalMaterials: _materials, ...value } = run
  return value
}

const LEGACY_REVIEW_PREFIX = '本阶段已生成成果，请审阅。\n\n'

async function withLegacyReviews(storage: string, runs: ResearchRun[], views: Array<{ artifacts: Artifact[] }>, messages: ResearchMessage[]) {
  const pending = messages.filter(message => !message.review && message.role === 'assistant' && message.text.startsWith(LEGACY_REVIEW_PREFIX))
  if (!pending.length) return messages
  for (const [index, run] of runs.entries()) {
    const home = join(runPath(storage, run), 'artifacts')
    const after = runs[index - 1]?.createdAt
    const selected = pending.filter(message => message.createdAt >= run.createdAt && (!after || message.createdAt < after))
    if (!selected.length) continue
    for (const file of views[index]?.artifacts ?? []) {
      if (!/^stage-\d{2}\//.test(file.path) || !/\.(md|yaml|txt)$/i.test(file.path) || REVIEW_METADATA.has(file.name)) continue
      if (selected.every(message => message.review)) break
      const path = join(home, file.path)
      try {
        if (!samePath(path, await realpath(path))) continue
        const handle = await open(path, 'r')
        try {
          const stat = await handle.stat()
          if (!stat.isFile()) continue
          const buffer = Buffer.alloc(4800)
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
          const excerpt = Array.from(buffer.toString('utf8', 0, bytesRead).replace(/\r\n?/g, '\n')).slice(0, 1200).join('').trim()
          const text = LEGACY_REVIEW_PREFIX + excerpt + (Array.from(excerpt).length === 1200 ? '…' : '')
          const message = selected.find(message => !message.review && message.text === text && Math.floor(stat.mtimeMs) <= Date.parse(message.createdAt))
          if (message) message.review = { runId: run.id, documents: [file] }
        } finally { await handle.close() }
      } catch {
        // A legacy result may have been moved, removed or replaced after the message was recorded.
      }
    }
  }
  return messages
}

async function readReviewText(home: string, run: ResearchRun, file: ReviewDocument, limit: number): Promise<string | undefined> {
  const path = join(home, artifactPath(file.path))
  try {
    if (!readableArtifact(run, file.path) || !samePath(path, await realpath(path))) return undefined
    const info = await lstat(path)
    return info.isFile() && info.size <= limit ? await readFile(path, 'utf8') : undefined
  } catch { return undefined }
}

async function withStageReview(storage: string, runs: ResearchRun[], message: ResearchMessage): Promise<ResearchMessage> {
  if (message.role !== 'assistant' || !message.review) return message
  const review = message.review
  const run = runs.find(candidate => candidate.id === review.runId)
  const stage = review.stage ?? stageOfReview(review.documents)
  if (!run || !stage) return message
  const home = join(runPath(storage, run), 'artifacts')
  try {
    const contents = new Map((await Promise.all(reviewDataFiles(stage, review.documents).map(async file => {
      const text = await readReviewText(home, run, file, file.name.endsWith('.jsonl') ? 4 * 1024 * 1024 : 512 * 1024)
      return [file.name, text] as const
    }))).flatMap(([name, text]) => text === undefined ? [] : [[name, text] as const]))
    const localMaterials = Boolean(run.submission?.materials.length || run.additionalMaterials?.length
      || run.submission?.conversation.slice(-10).some(turn => /[A-Za-z]:[/\\]/u.test(turn.text)))
    const text = stage === 'SEARCH_STRATEGY'
      ? searchStrategyReview(load(contents.get('search_plan.yaml') ?? '', { schema: JSON_SCHEMA }),
        JSON.parse(contents.get('sources.json') ?? '{}'), JSON.parse(contents.get('queries.json') ?? '{}'), localMaterials)
      : stageReview(stage, review.documents, contents)
    return text ? { ...message, text } : message
  } catch {
    return message
  }
}

async function projectValue(store: ResearchStore, projects: string, header: ProjectHeader, includeArtifacts = true) {
  const runs = store.runs(header.id)
  const storage = includeArtifacts && runs.length ? await projectStorage(projects, store, header.id).catch(() => undefined) : undefined
  const views = await Promise.all(runs.map(async run => ({ ...publicRun(run), artifacts: storage ? await artifacts(storage, run) : [] })))
  const storedMessages = includeArtifacts ? store.messages(header.id) : []
  const messages = storage ? await withLegacyReviews(storage, runs, views, storedMessages) : storedMessages
  return { ...header, directory: join(header.storageParent ?? projects, header.id), runs: views,
    messages: storage ? await Promise.all(messages.map(message => withStageReview(storage, runs, message))) : messages }
}

async function removeProjectFiles(projects: string, store: ResearchStore, projectId: string): Promise<void> {
  if (!store.pendingDeletion(projectId)) return
  const parent = store.storageParent(projectId) ?? projects
  const target = join(parent, requiredId(projectId))
  try {
    const info = await lstat(target)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new ResearchError(409, 'unsafe_project_path', '科研目录无法安全删除。')
    await projectStorage(projects, store, projectId)
    await checkedRunRoot(parent, target)
    await rm(target, { recursive: true, force: true })
  } catch (error) {
    if (!object(error) || error.code !== 'ENOENT') throw error
  }
  store.completeDeletion(projectId)
}

async function readArtifact(request: Request, store: ResearchStore, projects: string): Promise<Response> {
  const params = new URL(request.url).searchParams
  const run = store.run(requiredId(params.get('projectId')), requiredId(params.get('runId')))
  const path = artifactPath(params.get('path'))
  const media = artifactMedia(path)
  if (!media || !readableArtifact(run, path)) {
    throw new ResearchError(404, 'artifact_not_found', '找不到此科研成果。')
  }
  const storage = await projectStorage(projects, store, run.projectId)
  const folder = join(runPath(storage, run), 'artifacts')
  const target = join(folder, path)
  try {
    const canonicalRoot = await realpath(folder)
    const canonical = await realpath(target)
    if (!inside(storage, canonicalRoot) || relative(folder, canonicalRoot) !== ''
      || !inside(canonicalRoot, canonical) || relative(target, canonical) !== '') {
      throw new ResearchError(404, 'artifact_not_found', '找不到此科研成果。')
    }
    const handle = await open(canonical, 'r')
    try {
      const info = await handle.stat()
      if (!info.isFile() || info.size > ARTIFACT_BYTES) throw new ResearchError(413, 'artifact_too_large', '科研成果超出可读取大小。')
      const buffer = Buffer.alloc(info.size)
      let offset = 0
      while (offset < buffer.length) {
        const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset)
        if (bytesRead === 0) throw new ResearchError(409, 'artifact_changed', '成果文件发生变化，请重试。')
        offset += bytesRead
      }
      const headers = new Headers({ 'content-type': media.type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
      if (params.get('download') === '1' || ['pdf', 'html', 'csv', 'archive'].includes(media.kind)) {
        headers.set('content-disposition', "attachment; filename*=UTF-8''" + encodeURIComponent(path.split('/').at(-1) ?? 'result'))
      }
      return new Response(buffer, { headers })
    } finally { await handle.close() }
  } catch (error) {
    if (error instanceof ResearchError) throw error
    throw new ResearchError(404, 'artifact_not_found', '找不到此科研成果。')
  }
}

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { 'cache-control': 'no-store' } })
}

function failure(error: unknown): Response {
  if (error instanceof ResearchError) return json({ status: 'error', error: { code: error.code, message: error.message } }, error.status)
  return json({ status: 'error', error: { code: 'research_failed', message: '科研请求处理失败，请重试。' } }, 500)
}

async function body(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() !== 'application/json') {
    throw new ResearchError(415, 'unsupported_content_type', '科研操作需使用 JSON 请求。')
  }
  if (Number(request.headers.get('content-length')) > BODY_BYTES) throw new ResearchError(413, 'body_too_large', '科研操作参数过长。')
  const bytes = await request.arrayBuffer()
  if (bytes.byteLength > BODY_BYTES) throw new ResearchError(413, 'body_too_large', '科研操作参数过长。')
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(bytes))
    if (object(value)) return value
  } catch (_error) {
    // Normalize malformed JSON to the same request error as a non-object payload.
  }
  throw new ResearchError(400, 'invalid_json', '科研操作请求无效。')
}

/**
 * Register the research catalog, task controls, and project-scoped file reads.
 * @param ctx - Cordis connection context.
 * @param config - Local interpreters, storage root and read-only PLC data directory.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  if (!config.python || !isAbsolute(config.dataDir) || (config.projectsDir && !isAbsolute(config.projectsDir))
   ) throw new Error('Invalid TBM research API configuration')
  if (config.arcPython === undefined) {
    const local = [join(ROOT, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python')]
    if (process.platform === 'win32') local.unshift(join(ROOT, '..', '.runtime', 'python', 'python.exe'))
    for (const candidate of local) {
      try {
        if ((await lstat(candidate)).isFile()) {
          config = { ...config, arcPython: candidate }
          break
        }
      } catch (error) {
        if (!object(error) || error.code !== 'ENOENT') throw error
      }
    }
  }
  const configured = config.projectsDir ?? join(ROOT, 'projects')
  if (configured === config.dataDir || inside(config.dataDir, configured)) throw new Error('Research storage must be outside PLC data')
  await mkdir(configured, { recursive: true })
  const projects = await realpath(configured)
  const source = await optionalRealpath(config.dataDir) ?? config.dataDir
  if (projects === source || inside(source, projects)) throw new Error('Research storage must be outside PLC data')
  const store = new ResearchStore(join(projects, 'research.sqlite'))
  const sessions = new ResearchAgentSessions(ctx, config.arcPython ?? config.python, config.dataDir, join(projects, 'model-diagnostics.jsonl'))
  ctx.effect(() => async () => {
    await sessions.close()
    store.close()
  }, 'tbm research: close project sessions')

  const homeOf = async (projectId: string) => join(await projectStorage(projects, store, projectId), projectId)
  const detail = async (project: ProjectHeader) => {
    const former = await projectValue(store, projects, project)
    const assistant = await sessions.snapshot(project.id, await homeOf(project.id))
    const { messages, ...agent } = assistant
    return { ...former, messages: [...former.messages, ...messages], agent }
  }

  for (const id of store.deletions()) await removeProjectFiles(projects, store, id).catch(error => {
    ctx.logger('tbm-research').warn('Pending project cleanup could not complete', error)
  })

  ctx.connection.fetch.register({ path: '/api/tbm/research', methods: ['GET', 'POST'], requestBody: 'buffered', fetch: async request => {
    try {
      if (request.method === 'GET') {
        const listed = await Promise.all(store.list().map(project => projectValue(store, projects, project, false)))
        const stages = STAGE_CATALOG.map(([id, name], index) => ({ id, name, number: index + 1, available: true }))
        const { model, reasoningEffort } = ctx.agentDefaultModel.currentSelection()
        return json({ status: 'ready', capability: 'tbm-research', agentDriven: true, projects: listed, stages, model, reasoningEffort })
      }
      const input = await body(request)
      if (input.action === 'create') {
        const project = await createProject(store, config, projects, input)
        return json({ status: 'ok', project: await detail(project) })
      }
      const projectId = requiredId(input.projectId)
      if (input.action === 'delete') {
        if (!store.pendingDeletion(projectId)) {
          const snapshot = await sessions.snapshot(projectId, await homeOf(projectId))
          if (snapshot.active) throw new ResearchError(409, 'research_active', '科研助手正在运行，请先暂停。')
          await sessions.closeProject(projectId)
          store.interruptLegacy(projectId)
          store.deleteProject(projectId)
        }
        await removeProjectFiles(projects, store, projectId)
        return json({ status: 'ok', deleted: projectId })
      }
      const project = store.project(projectId)
      if (input.action === 'submit' || input.action === 'respond' || input.action === 'resume') {
        const home = await homeOf(projectId)
        const uploads = await researchUploadInputs(home, input.uploads)
        const defaultMessage = input.action === 'resume' ? '请根据当前项目记录继续刚才中断的研究任务。'
          : input.decision === 'approve' ? '我确认你刚才提出的方案，请继续。'
          : uploads.uploads.length ? '请查看我补充的资料。' : ''
        const message = requiredText(input.message || defaultMessage, '研究消息', 10_000)
        if (OUT_OF_SCOPE.test(message)) throw new ResearchError(400, 'subject_out_of_scope', '请提出 TBM、掘进、隧道或岩土工程研究问题。')
        await sessions.send(projectId, home, message, uploads, store.messages(projectId))
        store.interruptLegacy(projectId)
        store.touch(projectId)
      } else if (input.action === 'cancel') sessions.cancel(projectId)
      else if (input.action !== 'get') throw new ResearchError(400, 'invalid_action', '请通过项目对话发起科研任务。')
      return json({ status: 'ok', project: await detail(store.project(project.id)) })
    } catch (error) {
      if (!(error instanceof ResearchError)) ctx.logger('tbm-research').warn('Research request failed', error)
      return failure(error)
    }
  } })

  ctx.connection.fetch.register({ path: '/api/tbm/research-record', methods: ['GET'], requestBody: 'buffered', fetch: async request => {
    try {
      const params = new URL(request.url).searchParams
      const projectId = requiredId(params.get('projectId'))
      store.project(projectId)
      const home = await homeOf(projectId)
      const artifact = params.get('path')
      const path = artifact === null ? researchDocument(home, requiredId(params.get('id'))) : join(home, artifactPath(artifact))
      if (artifact !== null && !/^(?:research-experiments|research-data|literature)\//u.test(artifact)
        && !/^research-figures\/[0-9a-f-]+\.(?:png|jpg|webp)$/u.test(artifact)) {
        throw new ResearchError(404, 'record_not_found', '找不到该研究成果。')
      }
      await checkedRunRoot(home, dirname(path))
      const stat = await lstat(path)
      const media = artifactMedia(path)
      if (!samePath(path, await realpath(path)) || !stat.isFile() || !media) throw new ResearchError(404, 'record_not_found', '找不到该研究记录。')
      return new Response(Readable.toWeb(createReadStream(path)) as ReadableStream<Uint8Array>, { headers: {
        'content-type': artifact === null ? 'text/plain; charset=utf-8' : media.type, 'content-length': String(stat.size),
        ...(media.kind === 'image' && extname(path) === '.svg' ? { 'content-disposition': 'attachment' } : {}),
        'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
      } })
    } catch (error) { return failure(error) }
  } })

  ctx.connection.fetch.register({ path: '/api/tbm/research-upload', methods: ['POST'], requestBody: 'streaming', fetch: async request => {
    try {
      const params = new URL(request.url).searchParams
      const projectId = requiredId(params.get('projectId'))
      store.project(projectId)
      const storage = await projectStorage(projects, store, projectId)
      const home = join(storage, projectId)
      await mkdir(home, { recursive: true })
      await checkedRunRoot(storage, home)
      return json({ status: 'ok', upload: await saveResearchUpload(ctx, request, home, params.get('name')) })
    } catch (error) { return failure(error) }
  } })

  ctx.connection.fetch.register({ path: '/api/tbm/research-attachment', methods: ['GET'], requestBody: 'buffered', fetch: async request => {
    try {
      const params = new URL(request.url).searchParams
      const projectId = requiredId(params.get('projectId'))
      store.project(projectId)
      const home = join(await projectStorage(projects, store, projectId), projectId)
      const file = await readResearchUpload(home, params.get('id'))
      const inline = file.mediaType && !params.has('download')
      return new Response(Readable.toWeb(createReadStream(file.path)) as ReadableStream<Uint8Array>, { headers: {
        'content-type': inline ? file.mediaType! : 'application/octet-stream',
        'content-length': String(file.upload.size),
        'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(file.upload.name)}`,
        'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff',
      } })
    } catch (error) { return failure(error) }
  } })

  ctx.connection.fetch.register({ path: '/api/tbm/research-artifact', methods: ['GET'], requestBody: 'buffered', fetch: async request => {
    try { return await readArtifact(request, store, projects) } catch (error) { return failure(error) }
  } })
}
