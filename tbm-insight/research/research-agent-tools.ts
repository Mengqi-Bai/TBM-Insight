/** Agent-selected operations scoped to one TBM research project. */
import type { Context } from '@tbm-insight/cordis'
import type { Agent } from '@tbm-insight/agent'
import { defineTool, type ToolDefinition } from '@tbm-insight/tools'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { copyFile, lstat, mkdir, open, opendir, readFile, realpath, rename, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inspectManuscript, manuscriptScopes, manuscriptUnits } from './research-manuscript.ts'
import { dataSources } from '../data-sources.ts'

const SCRIPT = fileURLToPath(new URL('./tbm_research_agent.py', import.meta.url))
const ID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/u
const RECORD_TYPES = ['question', 'review', 'decision', 'literature', 'analysis', 'manuscript', 'peer_review', 'revision_response', 'note'] as const
export const researchRoles = ['design', 'literature', 'experiment', 'writer', 'reviewer'] as const
export type ResearchRole = typeof researchRoles[number]
export interface DelegationRequest {
  role: ResearchRole
  task: string
  records: string[]
  paths: string[]
}
const PRIVATE = /^(?:\.|node_modules$)|(?:^|[_. -])(?:credentials?|secrets?|passwords?|api[_-]?keys?|tokens?)(?:[_. -]|$)/iu
type RecordKind = typeof RECORD_TYPES[number]

interface ProjectScope { home: string; python: string; dataDir: string; authorizedPaths?: readonly string[] }
export interface RecordMeta { id: string; title: string; kind: RecordKind; createdAt: string; references: string[] }

const answer = {
  schema: { type: 'string' },
  render: (_args: unknown, text: string) => [{ type: 'text' as const, text }],
} as const
const title = { type: 'string', description: '准确简短的中文操作标题，供用户查看，例如「重新拆解研究问题」。' } as const
const requiredPath = { type: 'string', required: true, description: '用户提供或本项目下的数据路径。直接传路径本身，空格和中文均可。' } as const

function contains(root: string, path: string) {
  const tail = relative(root, path)
  return tail !== '..' && !tail.startsWith('..' + sep) && !isAbsolute(tail)
}

async function checked(home: string, path: string) {
  if (!contains(home, path) || relative(path, await realpath(path))) throw new Error('项目路径不可用。')
  return path
}

function wasMentioned(candidate: string, text: string) {
  const normalized = candidate.replaceAll('\\', '/').toLowerCase()
  for (let start = text.indexOf(normalized); start !== -1; start = text.indexOf(normalized, start + normalized.length)) {
    const ending = text.slice(start + normalized.length)
    if (/^\/?(?:$|[\s"'”’」』】)，。；！？:;,!?)])/u.test(ending)) return true
  }
  return false
}

async function dataPath(agent: Agent, scope: ProjectScope, input: string) {
  const path = resolve(scope.home, input.trim().replace(/^["“「『']|["”」』']$/gu, ''))
  const configured = dataSources({ dataDir: scope.dataDir }).dataDir
  const root = configured && await realpath(configured).catch(() => '')
  const local = contains(scope.home, path)
  const child = path.split(sep).slice(1)
  if (child.some(part => PRIVATE.test(part))) throw new Error('该路径属于隐藏文件或私有配置，不能作为科研数据读取。')
  if (!local && scope.authorizedPaths && !scope.authorizedPaths.some(source => contains(source, path))) {
    throw new Error('该资料尚未交给本次协作任务。请由项目主助手补充资料。')
  }
  if (!local && !scope.authorizedPaths && (!root || !contains(root, path))) {
    const turns = agent.session.snapshotEvents().flatMap(event => event.type === 'user/message' && event.data.source.kind === 'user'
      ? event.data.content.flatMap(block => block.type === 'text' ? [block.text.replaceAll('\\', '/').toLowerCase()] : []) : [])
    let permitted = false
    for (let candidate = path; dirname(candidate) !== candidate; candidate = dirname(candidate)) {
      if (turns.some(text => wasMentioned(candidate, text))) { permitted = true; break }
    }
    if (!permitted) throw new Error('需要用户提供这个数据位置，或使用已给出目录中的文件。')
  }
  let actual: string
  try { actual = await realpath(path) }
  catch { throw new Error(`本机找不到或无法读取 ${path}。可核对名称或查看已授权的上级目录。`) }
  if (relative(actual, path)) throw new Error('当前路径经过链接。请使用本机数据的实际位置。')
  return actual
}

async function describeDirectory(path: string, prefix: string, after: string | undefined, signal: AbortSignal) {
  const selected: Array<{ name: string; kind: string }> = []
  let total = 0
  const dates = new Set<string>()
  for await (const entry of await opendir(path)) {
    signal.throwIfAborted()
    if (PRIVATE.test(entry.name) || (!entry.isFile() && !entry.isDirectory()) || !entry.name.includes(prefix)) continue
    total += 1
    const date = /(?:^|\D)((?:19|20)\d{6})(?=\D|$)/u.exec(entry.name)?.[1]
    if (date) dates.add(date)
    if (after && entry.name <= after) continue
    selected.push({ name: entry.name, kind: entry.isDirectory() ? 'directory' : 'file' })
    if (selected.length > 90) selected.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0).pop()
  }
  selected.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
  const ordered = [...dates].sort()
  return JSON.stringify({ path, total, datedEntries: dates.size, firstDateInNames: ordered[0], lastDateInNames: ordered.at(-1),
    items: selected, nextAfter: selected.length === 90 ? selected.at(-1)?.name : undefined })
}

function pythonTool(scope: ProjectScope, operation: string, payload: unknown, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([name]) =>
      /^(?:PATH|SYSTEMROOT|WINDIR|TEMP|TMP|PATHEXT|SYSTEMDRIVE|COMSPEC|LANG|LC_ALL)$/iu.test(name)))
    const child = spawn(scope.python, ['-B', '-X', 'utf8', SCRIPT, operation, scope.home], {
      env, cwd: scope.home, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    const abort = () => { child.kill() }
    signal.addEventListener('abort', abort, { once: true })
    child.on('error', reject)
    child.stdin.on('error', () => {})
    child.stdout.setEncoding('utf8').on('data', (data: string) => { stdout = (stdout + data).slice(-220_000) })
    child.stderr.setEncoding('utf8').on('data', (data: string) => { stderr = (stderr + data).slice(-3000) })
    child.on('close', code => {
      signal.removeEventListener('abort', abort)
      if (signal.aborted) reject(signal.reason)
      else if (code !== 0) reject(new Error(stderr.trim() || '科研工具运行失败。'))
      else resolve(stdout.trim())
    })
    child.stdin.end(JSON.stringify(payload))
    if (signal.aborted) abort()
  })
}

export async function listResearchRecords(home: string): Promise<RecordMeta[]> {
  const root = join(home, 'research-records')
  const directory = await opendir(root).catch(error => { if (error.code === 'ENOENT') return undefined; throw error })
  if (!directory) return []
  if (relative(root, await realpath(root))) { await directory.close(); throw new Error('项目记录目录不可用。') }
  const records: RecordMeta[] = []
  for await (const entry of directory) {
    if (!entry.isDirectory() || !ID.test(entry.name)) continue
    try {
      const meta = await checked(home, join(root, entry.name, 'record.json'))
      const record = JSON.parse(await readFile(meta, 'utf8')) as RecordMeta
      if (record.id === entry.name && typeof record.title === 'string' && typeof record.createdAt === 'string'
        && RECORD_TYPES.includes(record.kind) && Array.isArray(record.references)) records.push(record)
    } catch { /* Ignore incomplete or locally altered records. */ }
  }
  return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
}

async function figureType(path: string) {
  const bytes = Buffer.alloc(12)
  const file = await open(path, 'r')
  try { await file.read(bytes, 0, bytes.length, 0) } finally { await file.close() }
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png'
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'jpg'
  if (bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'webp'
  throw new Error('预览支持实际的 PNG、JPEG 或 WebP 图像。请为论文原图另存一份预览。')
}

export function installResearchTools(ctx: Context, agent: Agent, scope: ProjectScope, options: {
  allowed?: ReadonlySet<string>
  taskReferences?: readonly string[]
  delegate?: (request: DelegationRequest, signal: AbortSignal) => Promise<string>
} = {}) {
  const register = (tool: ToolDefinition) => {
    if (!options.allowed || options.allowed.has(tool.name)) ctx.tools.register(tool)
  }
  register(defineTool({
    name: 'research_records', description: '读取项目长程记忆。省略编号列出记录，给编号读取该记录全文。',
    parameters: { title, id: { type: 'string' }, offset: { type: 'integer' } }, output: answer,
    async execute({ id, offset }) {
      if (!id) return JSON.stringify({ projectDirectory: scope.home, records: (await listResearchRecords(scope.home)).slice(offset ?? 0, (offset ?? 0) + 50) })
      if (!ID.test(id)) throw new Error('请输入已有的记录编号。')
      return readFile(await checked(scope.home, join(scope.home, 'research-records', id, 'content.md')), 'utf8')
    },
  }))
  register(defineTool({
    name: 'research_save_record',
    description: '保存研究问题、待审议题、决策、文献、分析、论文、模拟同行评审（peer_review）或逐条返修回复（revision_response）。每次调用保存独立版本。需要用户作出重要选择时使用 review；用户作出决定后保存 decision，并在 references 包含待审议题编号。',
    parameters: { title: { ...title, required: true }, kind: { type: 'string', enum: RECORD_TYPES, required: true },
      markdown: { type: 'string', required: true }, references: { type: 'array', items: { type: 'string' },
        description: '依赖的已有研究记录编号、项目成果路径或可核对的引用。' } },
    output: answer,
    async execute(args, { signal }) {
      if (!args.title.trim() || !args.markdown.trim()) throw new Error('记录需要标题和正文。')
      const root = join(scope.home, 'research-records')
      await mkdir(root, { recursive: true })
      await checked(scope.home, root)
      const id = randomUUID()
      const folder = join(root, id)
      await mkdir(folder)
      const record: RecordMeta = { id, title: args.title.trim().slice(0, 90), kind: args.kind,
        createdAt: new Date().toISOString(), references: [...new Set([...options.taskReferences ?? [], ...args.references ?? []])] }
      await writeFile(join(folder, 'content.md'), args.markdown, { flag: 'wx' })
      await writeFile(join(folder, '.record.json'), JSON.stringify(record), { flag: 'wx' })
      signal.throwIfAborted()
      await rename(join(folder, '.record.json'), join(folder, 'record.json'))
      return JSON.stringify(record)
    },
  }))
  register(defineTool({
    name: 'research_inspect_data',
    description: '盘点实测数据。对目录给出文件数和文件名覆盖日期，可分页。对文件抽查字段、格式和样本。不会修改原始资料。',
    parameters: { title, path: requiredPath, nameContains: { type: 'string' }, after: { type: 'string' } }, output: answer,
    async execute(args, { signal }) {
      const path = await dataPath(agent, scope, args.path)
      if ((await lstat(path)).isDirectory()) return describeDirectory(path, args.nameContains ?? '', args.after, signal)
      return pythonTool(scope, 'inspect', { path }, signal)
    },
  }))
  register(defineTool({
    name: 'research_prepare_data',
    description: '流式预处理已定位的实测文件，支持 CSV、TSV、PLC TXT 和含表格的 ZIP。选取字段、按原始时间列过滤、落盘为分块 CSV，保留来源，记录缺字段和结构异常。',
    parameters: {
      title, path: requiredPath,
      startDate: { type: 'string', description: '包含的首日 YYYY-MM-DD。适用于 PLC 按日归档和指定时间列的表。' },
      endDate: { type: 'string', description: '包含的末日 YYYY-MM-DD。' },
      timeColumn: { type: 'string', description: '时间列原名。CREC188 可省略，默认使用运行时间。' },
      columns: { type: 'array', items: { type: 'string' }, description: '需要保留的原始列名。省略则全部保留。' },
    }, output: answer,
    async execute(args, { signal }) {
      const path = await dataPath(agent, scope, args.path)
      return pythonTool(scope, 'prepare', { ...args, path }, signal)
    },
  }))
  register(defineTool({
    name: 'research_run_python',
    description: '在本项目的隔离 Python 环境中执行分析、试验和绘图。Matplotlib 导出沿用共享字体、四边框、图例和无网格样式。独立图按内容选择 figsize，同时间范围的对照图可用 tbm_figure.new_figure(height, align_time=True) 对齐。绘图先加载 tbm-figure 并传稿件语言 figure_language。实测试验应读取 /data 的真实数据，写 results.json，包含 status=completed、source=real 和 metrics 对象。工具返回报告及产物位置。',
    parameters: {
      title, code: { type: 'string', required: true },
      inputs: { type: 'array', items: { type: 'string' }, description: '授权的输入文件或 research_prepare_data 生成的数据目录。' },
      purpose: { type: 'string', enum: ['analysis', 'experiment'] as const, required: true },
      figure_language: { type: 'string', enum: ['zh', 'en'] as const, description: '绘制论文图时必填。中文稿传 zh，英文稿传 en。标题、横纵轴、图例和图内说明用这一语言，保留单位、术语缩写和模型名称。纯分析可省略。' },
    }, output: answer,
    async execute(args, { signal }) {
      const inputs = await Promise.all((args.inputs ?? []).map(path => dataPath(agent, scope, path)))
      const result = await pythonTool(scope, 'run', { ...args, inputs }, signal)
      const report = JSON.parse(result) as { status: string; report: string; stderr: string }
      if (report.status !== 'succeeded') throw new Error(`${report.stderr.trim() || '试验运行未完成。'}\n运行报告 ${report.report}`)
      return result
    },
  }))
  register(defineTool({
    name: 'research_search_literature',
    description: '检索公开学术文献。query 使用公开主题关键词，省略项目私有路径和实测值。结果包含各来源标题、DOI 或链接。后续仍需核对引文和证据层级。',
    parameters: { title, query: { type: 'string', required: true } }, output: answer,
    async execute({ query }, { signal }) {
      if (/[A-Za-z]:[/\\]/u.test(query)) throw new Error('请改用公开学术关键词，移除本机路径。')
      return pythonTool(scope, 'search', { query }, signal)
    },
  }))
  register(defineTool({
    name: 'research_verify_citations',
    description: '用公开学术来源核对一组参考文献的题名和发表信息。输入 BibTeX，仅包含公开书目信息。结果是引文元数据核对，论文中的主张仍需查原文。',
    parameters: { title, bibtex: { type: 'string', required: true } }, output: answer,
    async execute({ bibtex }, { signal }) {
      if (/[A-Za-z]:[/\\]/u.test(bibtex)) throw new Error('请移除本机路径，保留公开书目信息。')
      return pythonTool(scope, 'verify', { bibtex }, signal)
    },
  }))
  register(defineTool({
    name: 'research_check_manuscript',
    description: '审计 Markdown 科技论文的实际篇幅、章节、清单式正文、工作备注和缺图。以真实期刊要求作为预算参数，正文、中文摘要、英文摘要和全稿可以分别选择口径。',
    parameters: {
      title, path: { type: 'string', description: '用户授权的稿件文件或本项目内的 Markdown 路径。' },
      recordId: { type: 'string', description: '已保存的稿件记录编号，可替代 path。' },
      journal: { type: 'string', description: '目标期刊及稿件类型。' },
      guidelineUrl: { type: 'string', description: '已核对的投稿须知或模板来源。' },
      budgets: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
        scope: { type: 'string', enum: manuscriptScopes, required: true },
        unit: { type: 'string', enum: manuscriptUnits, required: true },
        min: { type: 'integer' }, max: { type: 'integer' },
        includeCaptions: { type: 'boolean' }, includeTables: { type: 'boolean' },
      } } },
    }, output: answer,
    async execute(args, { signal }) {
      if (Boolean(args.recordId) === Boolean(args.path)) throw new Error('请指定一份稿件，使用路径或记录编号。')
      if (args.recordId && !ID.test(args.recordId)) throw new Error('稿件记录编号无效。')
      const path = args.recordId ? await checked(scope.home, join(scope.home, 'research-records', args.recordId, 'content.md'))
        : await dataPath(agent, scope, args.path!)
      if (!(await lstat(path)).isFile()) throw new Error('请提供可读的 Markdown 稿件文件。')
      return JSON.stringify({ journal: args.journal, guidelineUrl: args.guidelineUrl,
        ...inspectManuscript(await readFile(path, { encoding: 'utf8', signal }), args.budgets) })
    },
  }))
  register(defineTool({
    name: 'research_present_figures',
    description: '把直接支撑论文主要发现的实际图片及其图注显示在项目对话中。图片可以来自项目产物或用户提供的路径，保留可下载副本。',
    parameters: {
      title,
      figures: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
        path: requiredPath, caption: { type: 'string', required: true, description: '完整图注，包含图号、对象和必要的单位或分组。' },
      } } },
    }, output: answer,
    async execute({ figures }, { signal }) {
      if (!figures.length) throw new Error('请选取有实际图像的关键图。')
      const sources = []
      for (const figure of figures) {
        signal.throwIfAborted()
        if (!figure.caption.trim()) throw new Error('图注不能为空。')
        const path = await dataPath(agent, scope, figure.path)
        if (!(await lstat(path)).isFile()) throw new Error('请选择实际的图像文件。')
        sources.push({ path, format: await figureType(path), caption: figure.caption.trim() })
      }
      const folder = join(scope.home, 'research-figures')
      await mkdir(folder, { recursive: true })
      await checked(scope.home, folder)
      const items = []
      for (const source of sources) {
        signal.throwIfAborted()
        const name = `${randomUUID()}.${source.format}`
        await copyFile(source.path, join(folder, name))
        const filename = source.path.split(sep).at(-1) ?? name
        items.push({ path: `research-figures/${name}`, name: filename === 'content' ? name : filename, caption: source.caption, source: source.path })
      }
      return JSON.stringify({ figures: items })
    },
  }))
  const delegate = options.delegate
  if (delegate) register(defineTool({
    name: 'research_delegate',
    description: '把边界清楚的科研子任务交给独立会话。design 为选题与方法设计，literature 为文献证据，experiment 为数据与试验，writer 为学术写作，reviewer 为模拟同行评审。只传这项任务需要的项目记录和资料，结果回到当前主会话。',
    parameters: {
      title, role: { type: 'string', enum: researchRoles, required: true },
      task: { type: 'string', required: true, description: '独立的任务与交付要求，包含必要约束。' },
      records: { type: 'array', items: { type: 'string' }, description: '只传本任务需要读的项目记录编号。' },
      paths: { type: 'array', items: { type: 'string' }, description: '本任务需要读的项目产物或已获用户授权的路径。' },
    }, output: answer,
    isConcurrencySafe: () => true,
    async execute(args, { signal }) {
      if (!args.task.trim()) throw new Error('请说明要委派的科研子任务。')
      const records = [...new Set(args.records ?? [])]
      for (const id of records) {
        if (!ID.test(id)) throw new Error('科研记录编号无效。')
        await checked(scope.home, join(scope.home, 'research-records', id, 'content.md'))
      }
      const paths = await Promise.all([...new Set(args.paths ?? [])].map(path => dataPath(agent, scope, path)))
      return delegate({ role: args.role, task: args.task, records, paths }, signal)
    },
  }))
}
