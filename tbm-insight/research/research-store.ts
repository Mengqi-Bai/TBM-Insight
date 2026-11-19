/** SQLite state for TBM research projects, separate from conversation workspaces. */
import { randomUUID } from 'node:crypto'
import { DatabaseSync, type SQLOutputValue } from 'node:sqlite'
import type { ImageAttachmentRef } from '@tbm-insight/attachment'

/** Supported local research jobs. */
export type Workflow = 'tbm_week_comparison' | 'arc_research'
/** Persisted state used by the research UI and scheduler. */
export type Status = 'queued' | 'running' | 'waiting_for_input' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted'
/** A workflow's request for human review. */
export interface Gate { stage: string; message: string; decisions: string[] }
/** A validated response to the active review gate. */
export interface Decision { stage: string; decision: 'approve' | 'reject' | 'guide'; message?: string }
export interface Revision { id: string; stage: string; message: string }
/** Data needed to launch or display one run. */
export interface ResearchRun {
  id: string
  projectId: string
  workflow: Workflow
  parameters: Record<string, string>
  status: Status
  createdAt: string
  updatedAt: string
  startedAt?: string
  finishedAt?: string
  message?: string
  stage?: string
  stages?: StageProgress[]
  gate?: Gate
  decision?: Decision
  revision?: Revision
  queuedRevision?: Revision
  submission?: Submission
  additionalMaterials?: ResearchMaterial[]
  resume: boolean
}
/** Project header in the research catalog. */
export interface ProjectHeader { id: string; name: string; createdAt: string; updatedAt: string; storageParent?: string }
/** A durable turn in one project's research conversation. */
export interface ReviewDocument { path: string; name: string; kind: string }
export interface ResearchUpload { id: string; name: string; kind: string; size: number }
export interface ResearchMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  createdAt: string
  uploads?: ResearchUpload[]
  review?: { runId: string; stage?: string; documents: ReviewDocument[] }
  record?: { id: string; title: string }
  figures?: Array<{ path: string; name: string; caption: string }>
}
/** Real stage state reported by the research runner. */
export interface StageProgress { id: string; number: number; name: string; status: string; message?: string }
/** An explicitly referenced source file to prepare for one run. */
export interface ResearchMaterial { path: string; name: string; kind: string; size: number; files?: string[]; image?: ImageAttachmentRef }
export interface Submission { materials: ResearchMaterial[]; message: string; conversation: ResearchMessage[]; uploads?: ResearchUpload[] }
export interface ResearchIntake { topic: string; materials: ResearchMaterial[] }

/** Local API failure whose message can be displayed to an authenticated user. */
export class ResearchError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message) }
}

type Row = Record<string, SQLOutputValue>
const now = (): string => new Date().toISOString()

function runFromRow(row: Row): ResearchRun {
  const run = JSON.parse(String(row.body)) as ResearchRun
  return { ...run, status: row.status as Status }
}

/** Durable research queue shared by Web processes using the same research root. */
export class ResearchStore {
  private readonly db: DatabaseSync

  constructor(path: string) {
    this.db = new DatabaseSync(path)
    this.db.exec('PRAGMA busy_timeout=3000; PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON')
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id),
        status TEXT NOT NULL, created_at TEXT NOT NULL, body TEXT NOT NULL,
        worker TEXT, lease INTEGER, cancel_requested INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS research_runs_project ON runs(project_id, created_at);
      CREATE INDEX IF NOT EXISTS research_runs_queue ON runs(status, created_at);
      CREATE TABLE IF NOT EXISTS messages (
        sequence INTEGER PRIMARY KEY, id TEXT UNIQUE NOT NULL, project_id TEXT NOT NULL REFERENCES projects(id),
        role TEXT NOT NULL, text TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS research_messages_project ON messages(project_id, sequence);
      CREATE TABLE IF NOT EXISTS research_message_reviews (
        message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE, body TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS research_message_uploads (
        message_id TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE, body TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS project_deletions (
        project_id TEXT PRIMARY KEY, removed_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS project_locations (project_id TEXT PRIMARY KEY, parent TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS research_intake (
        project_id TEXT PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE, body TEXT NOT NULL
      );
    `)
  }

  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const result = work()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }

  list(): ProjectHeader[] {
    return this.db.prepare('SELECT id, name, created_at AS createdAt, updated_at AS updatedAt FROM projects ORDER BY updated_at DESC, id')
      .all().map(row => this.projectHeader(row))
  }

  project(id: string): ProjectHeader {
    const row = this.db.prepare('SELECT id, name, created_at AS createdAt, updated_at AS updatedAt FROM projects WHERE id = ?').get(id)
    if (!row) throw new ResearchError(404, 'project_not_found', '找不到此科研项目。')
    return this.projectHeader(row)
  }

  private projectHeader(row: Row): ProjectHeader {
    const id = String(row.id)
    const storageParent = this.storageParent(id)
    return { id, name: String(row.name), createdAt: String(row.createdAt), updatedAt: String(row.updatedAt),
      ...(storageParent === undefined ? {} : { storageParent }) }
  }

  storageParent(id: string): string | undefined {
    const parent = this.db.prepare('SELECT parent FROM project_locations WHERE project_id=?').get(id)?.parent
    return typeof parent === 'string' ? parent : undefined
  }

  create(name: string, id: string, storageParent?: string): ProjectHeader {
    const time = now()
    return this.transaction(() => {
      this.db.prepare('INSERT INTO projects VALUES (?, ?, ?, ?)').run(id, name, time, time)
      if (storageParent !== undefined) this.db.prepare('INSERT INTO project_locations VALUES(?,?)').run(id, storageParent)
      return this.project(id)
    })
  }

  runs(projectId: string): ResearchRun[] {
    return this.db.prepare('SELECT body, status FROM runs WHERE project_id = ? ORDER BY created_at DESC, id DESC')
      .all(projectId).map(runFromRow)
  }

  messages(projectId: string): ResearchMessage[] {
    return this.db.prepare(`SELECT m.id,m.role,m.text,m.created_at AS createdAt,r.body,u.body AS uploads FROM messages m
      LEFT JOIN research_message_reviews r ON r.message_id=m.id LEFT JOIN research_message_uploads u ON u.message_id=m.id
      WHERE m.project_id=? ORDER BY m.sequence`)
      .all(projectId).map(row => ({ id: String(row.id), role: row.role as ResearchMessage['role'], text: String(row.text), createdAt: String(row.createdAt),
        ...(typeof row.uploads === 'string' ? { uploads: JSON.parse(row.uploads) as ResearchUpload[] } : {}),
        ...(typeof row.body === 'string' ? { review: JSON.parse(row.body) as NonNullable<ResearchMessage['review']> } : {}) }))
  }

  private recentMessages(projectId: string): ResearchMessage[] {
    return this.db.prepare('SELECT id,role,text,created_at AS createdAt FROM messages WHERE project_id=? ORDER BY sequence DESC LIMIT 16')
      .all(projectId).reverse().map(row => ({ id: String(row.id), role: row.role as ResearchMessage['role'], text: String(row.text), createdAt: String(row.createdAt) }))
  }

  private addMessage(projectId: string, role: ResearchMessage['role'], text: string, review?: ResearchMessage['review'], uploads?: ResearchUpload[]): void {
    const id = randomUUID()
    this.db.prepare('INSERT INTO messages(id,project_id,role,text,created_at) VALUES(?,?,?,?,?)')
      .run(id, projectId, role, text, now())
    if (review) this.db.prepare('INSERT INTO research_message_reviews VALUES(?,?)').run(id, JSON.stringify(review))
    if (uploads?.length) this.db.prepare('INSERT INTO research_message_uploads VALUES(?,?)').run(id, JSON.stringify(uploads))
  }

  discuss(projectId: string, user: string, answer: string, uploads?: ResearchUpload[], intake?: ResearchIntake): void {
    this.transaction(() => {
      this.project(projectId)
      this.addMessage(projectId, 'user', user, undefined, uploads)
      this.addMessage(projectId, 'assistant', answer)
      if (intake) this.db.prepare(`INSERT INTO research_intake VALUES(?,?)
        ON CONFLICT(project_id) DO UPDATE SET body=excluded.body`).run(projectId, JSON.stringify(intake))
      this.db.prepare('UPDATE projects SET updated_at=? WHERE id=?').run(now(), projectId)
    })
  }

  pendingIntake(projectId: string): ResearchIntake | undefined {
    const body = this.db.prepare('SELECT body FROM research_intake WHERE project_id=?').get(projectId)?.body
    return typeof body === 'string' ? JSON.parse(body) as ResearchIntake : undefined
  }

  touch(projectId: string): void {
    this.db.prepare('UPDATE projects SET updated_at=? WHERE id=?').run(now(), projectId)
  }

  run(projectId: string, runId: string): ResearchRun {
    const row = this.db.prepare('SELECT body, status FROM runs WHERE project_id = ? AND id = ?').get(projectId, runId)
    if (!row) throw new ResearchError(404, 'run_not_found', '找不到此科研任务。')
    return runFromRow(row)
  }

  enqueue(projectId: string, workflow: Workflow, parameters: Record<string, string>, submission?: Omit<Submission, 'conversation'>): void {
    const createdAt = now()
    const run: ResearchRun = { id: randomUUID(), projectId, workflow, parameters, status: 'queued', createdAt, updatedAt: createdAt, resume: false }
    this.transaction(() => {
      this.project(projectId)
      this.checkQueue()
      this.ensureIdle(projectId)
      if (submission) {
        this.addMessage(projectId, 'user', submission.message, undefined, submission.uploads)
        const conversation = this.recentMessages(projectId)
        run.submission = { ...submission, conversation }
        this.db.prepare('DELETE FROM research_intake WHERE project_id=?').run(projectId)
      }
      this.db.prepare('INSERT INTO runs(id, project_id, status, created_at, body) VALUES (?, ?, ?, ?, ?)')
        .run(run.id, projectId, run.status, createdAt, JSON.stringify(run))
      this.touchProject(run)
    })
  }

  private ensureIdle(projectId: string, except?: string): void {
    const active = this.db.prepare("SELECT id FROM runs WHERE project_id=? AND status IN ('queued','running','waiting_for_input') AND id<>? LIMIT 1")
      .get(projectId, except ?? '')
    if (active) throw new ResearchError(409, 'research_active', '项目已有进行中的任务，请先完成或停止。')
  }

  deleteProject(projectId: string): void {
    this.transaction(() => {
      this.project(projectId)
      this.ensureIdle(projectId)
      this.db.prepare('INSERT OR IGNORE INTO project_deletions VALUES(?,?)').run(projectId, now())
      this.db.prepare('DELETE FROM messages WHERE project_id=?').run(projectId)
      this.db.prepare('DELETE FROM runs WHERE project_id=?').run(projectId)
      this.db.prepare('DELETE FROM projects WHERE id=?').run(projectId)
    })
  }

  pendingDeletion(projectId: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM project_deletions WHERE project_id=?').get(projectId))
  }

  deletions(): string[] {
    return this.db.prepare('SELECT project_id FROM project_deletions ORDER BY removed_at').all().map(row => String(row.project_id))
  }

  completeDeletion(projectId: string): void {
    this.transaction(() => {
      this.db.prepare('DELETE FROM project_deletions WHERE project_id=?').run(projectId)
      this.db.prepare('DELETE FROM project_locations WHERE project_id=?').run(projectId)
    })
  }

  private checkQueue(): void {
    const { count } = this.db.prepare("SELECT count(*) AS count FROM runs WHERE status='queued'").get() ?? { count: 0 }
    if (Number(count) >= 16) throw new ResearchError(503, 'research_queue_full', '科研任务队列已满，请稍后重试。')
  }

  claim(worker: string, lease: number): ResearchRun | undefined {
    return this.transaction(() => {
      const expired = this.db.prepare("SELECT body, status, cancel_requested FROM runs WHERE status='running' AND lease < ?").all(Date.now())
      for (const row of expired) {
        const run = runFromRow(row)
        if (this.queueRevision(run)) continue
        if (row.cancel_requested === 1) this.finish(run, 'cancelled', '任务已暂停。')
        else this.finish(run, 'interrupted', '上一次运行已中断，可继续或重新运行。')
      }
      if (this.db.prepare("SELECT 1 FROM runs WHERE status='running' LIMIT 1").get()) return undefined
      const item = this.db.prepare("SELECT body, status FROM runs WHERE status='queued' ORDER BY json_extract(body, '$.updatedAt'), created_at, id LIMIT 1")
      const row = item.get()
      if (!row) return undefined
      const run = runFromRow(row)
      run.status = 'running'
      run.startedAt = now()
      run.updatedAt = run.startedAt
      delete run.finishedAt
      delete run.message
      if (run.workflow === 'tbm_week_comparison') run.stage = 'COMPARE_WEEKS'
      this.db.prepare("UPDATE runs SET status='running', body=?, worker=?, lease=?, cancel_requested=0 WHERE id=?")
        .run(JSON.stringify(run), worker, lease, run.id)
      this.touchProject(run)
      return run
    })
  }

  heartbeat(id: string, worker: string, lease: number): 'active' | 'cancel' | 'lost' {
    const row = this.db.prepare("UPDATE runs SET lease=? WHERE id=? AND worker=? AND status='running' RETURNING cancel_requested")
      .get(lease, id, worker)
    return row ? row.cancel_requested === 1 ? 'cancel' : 'active' : 'lost'
  }

  stageOwned(run: ResearchRun, worker: string, stage?: string, stages?: StageProgress[]): void {
    const progress = { ...run, updatedAt: now() }
    if (stage !== undefined) progress.stage = stage
    if (stages !== undefined) progress.stages = stages
    const changed = this.db.prepare("UPDATE runs SET body=? WHERE id=? AND worker=? AND status='running' AND cancel_requested=0")
      .run(JSON.stringify(progress), run.id, worker)
    if (changed.changes) this.touchProject(progress)
  }

  finishOwned(run: ResearchRun, worker: string, status: Status, message: string, stage?: string, gate?: Gate, stages?: StageProgress[], documents?: ReviewDocument[]): void {
    this.transaction(() => {
      const row = this.db.prepare("SELECT body, status, cancel_requested FROM runs WHERE id=? AND worker=? AND status='running'").get(run.id, worker)
      if (!row) return
      const current = runFromRow(row)
      if (this.queueRevision(current)) return
      if (row.cancel_requested === 1 && current.revision && current.revision.id !== run.revision?.id) {
        this.finish(current, 'cancelled', '任务已暂停。')
        return
      }
      if (stage !== undefined) current.stage = stage
      if (stages !== undefined) current.stages = stages
      if (gate !== undefined) current.gate = gate
      else delete current.gate
      delete current.decision
      if (status === 'waiting_for_input' || status === 'succeeded') delete current.revision
      if (row.cancel_requested === 1) this.finish(current, 'cancelled', '任务已暂停。')
      else this.finish(current, status, message, documents)
    })
  }

  cancel(projectId: string, runId: string): void {
    this.transaction(() => {
      const run = this.run(projectId, runId)
      if (run.status === 'running') {
        if (run.queuedRevision) {
          run.revision = run.queuedRevision
          delete run.queuedRevision
        }
        run.message = '正在暂停任务。'
        run.updatedAt = now()
        this.db.prepare('UPDATE runs SET body=?, cancel_requested=1 WHERE id=?').run(JSON.stringify(run), run.id)
        this.touchProject(run)
      } else if (run.status === 'queued' || run.status === 'waiting_for_input') {
        delete run.gate
        delete run.decision
        this.finish(run, 'cancelled', '任务已暂停。')
      } else {
        throw new ResearchError(409, 'invalid_run_state', '此任务当前无法取消。')
      }
    })
  }

  /** Close former workflow jobs when a project switches to the research session. */
  interruptLegacy(projectId: string): void {
    this.transaction(() => {
      for (const run of this.runs(projectId)) {
        if (!['queued', 'running', 'waiting_for_input'].includes(run.status)) continue
        delete run.gate
        delete run.decision
        delete run.queuedRevision
        this.finish(run, 'interrupted', '原流程已保存为历史记录。请在项目对话中继续研究。')
      }
    })
  }

  restart(projectId: string, runId: string, response?: Pick<Decision, 'decision' | 'message'>): void {
    this.transaction(() => {
      const run = this.run(projectId, runId)
      this.ensureIdle(projectId, runId)
      if (response) {
        if (run.status !== 'waiting_for_input' || !run.gate?.decisions.includes(response.decision)) {
          throw new ResearchError(409, 'invalid_gate', '此任务没有对应的待审操作。')
        }
        run.decision = { stage: run.gate.stage, ...response }
      } else if (!['cancelled', 'failed', 'interrupted'].includes(run.status)) {
        throw new ResearchError(409, 'invalid_run_state', '此任务当前无法恢复。')
      }
      this.checkQueue()
      delete run.gate
      delete run.finishedAt
      run.resume = true
      if (run.submission && response) {
        const labels = { approve: '确认，进入下一阶段。', reject: '退回本阶段。', guide: '请修改这一阶段。' }
        this.addMessage(projectId, 'user', response.message || labels[response.decision])
      }
      this.finish(run, 'queued', '任务已加入运行队列。')
    })
  }

  revise(projectId: string, runId: string, stage: string, message: string, guidance = message, uploads?: ResearchUpload[], materials?: ResearchMaterial[]): void {
    this.transaction(() => {
      const run = this.run(projectId, runId)
      this.ensureIdle(projectId, runId)
      if (materials?.length) {
        const prior = run.submission?.materials ?? []
        const seen = new Set(prior.map(file => file.path))
        const additional = [...run.additionalMaterials ?? [], ...materials].filter(file => {
          if (seen.has(file.path)) return false
          seen.add(file.path)
          return true
        })
        if (seen.size > 32 || [...prior, ...additional].reduce((size, file) => size + file.size, 0) > 256 * 1024 * 1024) {
          throw new ResearchError(413, 'materials_limit', '该任务的资料共可保存 32 个条目、256 MB。')
        }
        run.additionalMaterials = additional
      }
      if (run.status !== 'queued') this.checkQueue()
      const stages = run.stages
      const target = stages?.find(item => item.id === stage)?.number
      if (stages && target !== undefined) {
        run.stages = stages.map(item => item.number < target || item.status === 'skipped' ? item
          : { id: item.id, name: item.name, number: item.number, status: 'pending' })
      }
      run.stage = stage
      run.resume = true
      delete run.gate
      delete run.decision
      delete run.finishedAt
      this.addMessage(projectId, 'user', message, undefined, uploads)
      run.queuedRevision = { id: randomUUID(), stage, message: guidance }
      if (run.status === 'running') {
        run.updatedAt = now()
        run.message = '正在切换到要修改的阶段。'
        this.db.prepare('UPDATE runs SET body=?, cancel_requested=1 WHERE id=?').run(JSON.stringify(run), run.id)
        this.touchProject(run)
      } else this.queueRevision(run)
    })
  }

  private queueRevision(run: ResearchRun): boolean {
    if (!run.queuedRevision) return false
    run.revision = run.queuedRevision
    delete run.queuedRevision
    this.finish(run, 'queued', '已安排修改本阶段。')
    return true
  }

  private finish(run: ResearchRun, status: Status, message: string, documents?: ReviewDocument[]): void {
    run.status = status
    run.updatedAt = now()
    run.message = message
    if (status !== 'queued' && status !== 'waiting_for_input') run.finishedAt = run.updatedAt
    this.db.prepare('UPDATE runs SET status=?, body=?, worker=NULL, lease=NULL, cancel_requested=0 WHERE id=?')
      .run(status, JSON.stringify(run), run.id)
    this.touchProject(run)
    if (run.submission && status !== 'queued') {
      if (documents?.length) this.addMessage(run.projectId, 'assistant', '本阶段已生成成果，请审阅。', {
        runId: run.id, ...(run.stage ? { stage: run.stage } : {}), documents,
      })
      else this.addMessage(run.projectId, 'assistant', message)
    }
  }

  private touchProject(run: ResearchRun): void {
    this.db.prepare('UPDATE projects SET updated_at=? WHERE id=?').run(run.updatedAt, run.projectId)
  }

  close(): void { this.db.close() }
}
