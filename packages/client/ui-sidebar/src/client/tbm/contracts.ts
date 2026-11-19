import type { ObservableSnapshot } from '@tbm-insight/client-store'

export const PANELS = ['progress', 'conditions', 'cutters', 'evidence'] as const
export type Panel = typeof PANELS[number]

export interface ConditionRange {
  readonly date: string
  readonly start_time?: string
  readonly end_time?: string
  readonly focus?: 'limits'
}

export interface Viewing {
  readonly sourceRevision?: number
  readonly conditionRange?: ConditionRange
  readonly week?: { readonly start_date: string; readonly end_date: string }
  readonly progressDate?: string
}

export interface Filters {
  readonly date?: string
  readonly start_date?: string
  readonly end_date?: string
  readonly start_time?: string
  readonly end_time?: string
  readonly detail?: 'week' | 'day'
  readonly query?: string
  readonly evidence_mode?: 'auto' | 'standard' | 'case' | 'both'
  readonly region?: string
}

export type Data = Readonly<Record<string, unknown>>

export interface PanelResponse {
  readonly status: string
  readonly origin: string
  readonly data: Data
}

export interface PanelOptions {
  readonly dates: readonly string[]
  readonly defaultDate: string
  readonly regions: readonly string[]
  readonly documents?: readonly Data[]
}

export interface PanelInjected {
  readonly panel: Panel
  readonly hooks: { readonly viewing: ObservableSnapshot<Viewing> }
  readonly openConditions: (range: ConditionRange) => void
  readonly rememberWeek: (week: NonNullable<Viewing['week']>, progressDate: string) => void
  readonly openDraft: (prompt: string) => void
  readonly options: (signal: AbortSignal) => Promise<PanelOptions>
  readonly load: (filters: Filters, signal: AbortSignal) => Promise<PanelResponse>
  readonly peekOptions?: () => PanelOptions | undefined
  readonly peekResult?: (filters: Filters) => PanelResponse | undefined
  readonly peekQuery?: () => Filters | undefined
  readonly rememberQuery?: (filters: Filters | undefined) => void
  readonly fileUrl: (path: string) => string
}

export function record(value: unknown): Data {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Data : {}
}

export function rows(value: unknown): Data[] {
  return Array.isArray(value) ? value.map(record) : []
}

export function text(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' && Number.isFinite(value) ? String(value) : ''
}

export function numeric(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

