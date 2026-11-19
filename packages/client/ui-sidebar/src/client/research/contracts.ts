import { record, rows, text } from '../tbm/contracts.ts'

export type RunStatus = 'queued' | 'running' | 'waiting_for_input' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted'
export type StageStatus = RunStatus | 'pending' | 'blocked' | 'skipped' | 'completed'

export interface ResearchArtifact {
  path: string
  name: string
  kind?: string
  caption?: string
}

export interface ResearchStage {
  id: string
  number: number
  available: boolean
  reason: string
}

export interface StageProgress {
  id: string
  status: StageStatus
  message: string
  artifacts: ResearchArtifact[]
}

export interface ResearchRun {
  id: string
  status: RunStatus
  topic: string
  model: string
  createdAt: string
  updatedAt: string
  message: string
  stage: string
  stages: StageProgress[]
  artifacts: ResearchArtifact[]
  gate?: { stage: string; decisions: string[] }
}

export interface ResearchMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  createdAt: string
  uploads?: ResearchUpload[]
  review?: { runId: string; documents: ResearchArtifact[] }
  record?: { id: string; title: string }
  figures?: ResearchArtifact[]
}

export interface ResearchUpload { id: string; name: string; size: number; kind: string }

export interface ResearchAssistant {
  active: boolean
  paused: boolean
  failure: string
  activities: Array<{ id: string; title: string; state: 'running' | 'succeeded' | 'failed' | 'interrupted'; detail: string; artifacts: ResearchArtifact[] }>
  records: Array<{ id: string; title: string; kind: string; createdAt: string }>
  pendingReview?: { id: string; title: string }
}

export interface ResearchProject {
  id: string
  name: string
  updatedAt: string
  runs: ResearchRun[]
  messages: ResearchMessage[]
  directory?: string
  agent?: ResearchAssistant
}

export interface ResearchCatalog {
  projects: ResearchProject[]
  stages: ResearchStage[]
  model?: string
  reasoningEffort?: string
  agentDriven?: boolean
}

export type ResearchCommand =
  { action: 'create'; name: string; directory?: string } |
  { action: 'get' | 'delete'; projectId: string } |
  { action: 'submit'; projectId: string; message: string; uploads?: string[] } |
  { action: 'cancel' | 'resume'; projectId: string; runId?: string } |
  { action: 'respond'; projectId: string; runId: string; decision: 'approve' | 'guide'; message?: string; uploads?: string[] }

export interface ResearchInjected {
  catalog: (signal: AbortSignal) => Promise<ResearchCatalog>
  request: (command: ResearchCommand, signal?: AbortSignal) => Promise<ResearchProject | undefined>
  artifactUrl: (projectId: string, runId: string, path: string, download?: boolean) => string
  pickDirectory?: () => Promise<string | null>
  upload?: (projectId: string, file: File) => Promise<ResearchUpload>
  uploadUrl?: (projectId: string, id: string, download?: boolean) => string
  recordUrl?: (projectId: string, id: string, kind?: 'record' | 'file') => string
}

export function parseUpload(value: unknown): ResearchUpload | undefined {
  const item = record(value)
  if (typeof item.id !== 'string' || typeof item.name !== 'string' || typeof item.kind !== 'string' || typeof item.size !== 'number') return undefined
  return { id: item.id, name: item.name, kind: item.kind, size: item.size }
}

const RUN_STATUS = ['queued', 'running', 'waiting_for_input', 'succeeded', 'failed', 'cancelled', 'interrupted'] as const
const STAGE_STATUS: ReadonlySet<string> = new Set<StageStatus>([...RUN_STATUS, 'pending', 'blocked', 'skipped', 'completed'])

function parseArtifacts(value: unknown): ResearchArtifact[] {
  return rows(value).flatMap(artifact => {
    const path = text(artifact.path)
    return path ? [{ path, name: text(artifact.name) || path, ...(typeof artifact.kind === 'string' ? { kind: artifact.kind } : {}),
      ...(typeof artifact.caption === 'string' ? { caption: artifact.caption } : {}) }] : []
  })
}

function parseRun(value: Readonly<Record<string, unknown>>): ResearchRun[] {
  if (typeof value.id !== 'string' || typeof value.status !== 'string' || !(RUN_STATUS as readonly string[]).includes(value.status)) return []
  const gate = record(value.gate)
  const decisions = Array.isArray(gate.decisions) ? gate.decisions.filter((decision): decision is string => typeof decision === 'string') : []
  return [{
    id: value.id, status: value.status as RunStatus, topic: text(record(value.parameters).topic), model: text(record(value.parameters).model),
    stage: text(value.stage), createdAt: text(value.createdAt), updatedAt: text(value.updatedAt),
    message: text(value.message), artifacts: parseArtifacts(value.artifacts),
    ...(typeof gate.stage === 'string' ? { gate: { stage: gate.stage, decisions } } : {}),
    stages: rows(value.stages).flatMap(stage => {
      const id = text(stage.id)
      const status = text(stage.status)
      return id && STAGE_STATUS.has(status)
        ? [{ id, status: status as StageStatus, message: text(stage.message), artifacts: parseArtifacts(stage.artifacts) }]
        : []
    }),
  }]
}

/** Decode a project from the research API. */
export function parseProject(source: unknown): ResearchProject | undefined {
  const value = record(source)
  if (typeof value.id !== 'string' || typeof value.name !== 'string') return undefined
  const agent = record(value.agent)
  const pendingReview = record(agent.pendingReview)
  return {
    id: value.id, name: value.name, updatedAt: text(value.updatedAt), runs: rows(value.runs).flatMap(parseRun),
    ...(typeof value.directory === 'string' ? { directory: value.directory } : {}),
    ...(typeof agent.active === 'boolean' ? { agent: {
      active: agent.active, paused: agent.paused === true, failure: text(agent.failure),
      ...(typeof pendingReview.id === 'string' && typeof pendingReview.title === 'string'
        ? { pendingReview: { id: pendingReview.id, title: pendingReview.title } } : {}),
      activities: rows(agent.activities).flatMap(item => {
        const state = item.state
        return typeof item.id === 'string' && typeof item.title === 'string'
          && (state === 'running' || state === 'succeeded' || state === 'failed' || state === 'interrupted')
          ? [{ id: item.id, title: item.title, state, detail: text(item.detail), artifacts: parseArtifacts(item.artifacts) }] : []
      }),
      records: rows(agent.records).flatMap(item => typeof item.id === 'string' && typeof item.title === 'string'
        ? [{ id: item.id, title: item.title, kind: text(item.kind), createdAt: text(item.createdAt) }] : []),
    } } : {}),
    messages: rows(value.messages).flatMap(message => {
      if (typeof message.id !== 'string' || typeof message.text !== 'string' || (message.role !== 'user' && message.role !== 'assistant')) return []
      const review = record(message.review)
      const saved = record(message.record)
      const figures = parseArtifacts(message.figures).map(figure => ({ ...figure, kind: 'image' }))
      const uploads = Array.isArray(message.uploads) ? message.uploads.flatMap(item => parseUpload(item) ?? []) : []
      return [{ id: message.id, role: message.role, text: message.text, createdAt: text(message.createdAt),
        ...(uploads.length ? { uploads } : {}),
        ...(figures.length ? { figures } : {}),
        ...(typeof saved.id === 'string' && typeof saved.title === 'string' ? { record: { id: saved.id, title: saved.title } } : {}),
        ...(typeof review.runId === 'string' ? { review: { runId: review.runId, documents: parseArtifacts(review.documents) } } : {}) }]
    }),
  }
}

/** Decode the catalog and its ordered upstream stages. */
export function parseCatalog(source: unknown): ResearchCatalog {
  const value = record(source)
  const stageValues = Array.isArray(value.stages) ? value.stages : []
  return {
    projects: rows(value.projects).flatMap(project => parseProject(project) ?? []),
    ...(typeof value.model === 'string' ? { model: value.model } : {}),
    ...(typeof value.reasoningEffort === 'string' ? { reasoningEffort: value.reasoningEffort } : {}),
    ...(value.agentDriven === true ? { agentDriven: true } : {}),
    stages: stageValues.flatMap((stage, index) => {
      if (typeof stage === 'string' && stage) return [{ id: stage, number: index + 1, available: true, reason: '' }]
      const item = record(stage)
      const id = text(item.id)
      if (!id) return []
      return [{ id, number: typeof item.number === 'number' ? item.number : index + 1, available: item.available !== false, reason: text(item.reason) }]
    }),
  }
}

/** True while a run is active or waiting on user input. */
export function isActive(run: ResearchRun): boolean {
  return run.status === 'queued' || run.status === 'running' || run.status === 'waiting_for_input'
}

