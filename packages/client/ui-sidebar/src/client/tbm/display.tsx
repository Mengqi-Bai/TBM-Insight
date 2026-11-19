import type { ReactNode, Ref } from 'react'
import type { PropsLocale } from '@tbm-insight/client-ui-slots'
import { numeric, record, text, type Data, type PanelInjected, type PanelResponse } from './contracts.ts'
import css from './TbmPanel.module.css'

export type Translate = PropsLocale<'tbmPanels'>['t']

export interface DayDetail {
  readonly date: string
  readonly result: PanelResponse | undefined
  readonly pending: boolean
  readonly error: string | undefined
  readonly retry: () => void
  readonly close: () => void
}

export interface ResultProps {
  readonly result: PanelResponse
  readonly t: Translate
  readonly detail: DayDetail | undefined
  readonly focusLimits: boolean
  readonly selectedDate: string
  readonly canSelectDate: (date: string) => boolean
  readonly selectDate: (date: string, trigger?: HTMLElement) => void
  readonly openConditions: PanelInjected['openConditions']
  readonly openDraft: PanelInjected['openDraft']
  readonly fileUrl: PanelInjected['fileUrl']
}

const numberFormat = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2 })

export function number(value: unknown): string {
  const amount = numeric(value)
  return amount === undefined ? '—' : numberFormat.format(amount)
}

export function duration(value: unknown, t: Translate): string {
  const amount = numeric(value)
  if (amount === undefined) return '—'
  const seconds = Math.max(0, Math.floor(amount))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor(seconds % 3600 / 60)
  return [hours > 0 ? `${hours} ${t('hours')}` : '', minutes > 0 ? `${minutes} ${t('minutes')}` : '',
    seconds % 60 > 0 || seconds === 0 ? `${seconds % 60} ${t('seconds')}` : ''].filter(Boolean).join(' ')
}

export function timestamp(value: unknown): string {
  return text(value).replace('T', ' ')
}

export function windowLabel(window: unknown, t: Translate): string {
  const value = record(window)
  const start = timestamp(value.start ?? value.start_date)
  const end = timestamp(value.end ?? value.end_date)
  return start && end ? t('dateRange', { start, end }) : start || end
}

export function sourceLabel(origin: string, t: Translate): string {
  return origin === 'historical' || origin === 'knowledge_index' ? t(origin) : t('noValues')
}

export function continueInChat(props: ResultProps, facts: readonly string[]): void {
  props.openDraft(props.t('draft', {
    source: sourceLabel(props.result.origin, props.t),
    facts: facts.filter(Boolean).join('\n'),
  }))
}

export function percent(value: unknown): string {
  const fraction = numeric(value)
  return fraction === undefined ? '—' : `${number(fraction * 100)}%`
}
export function evidenceLabel(evidence: Data, t: Translate): string {
  const start = text(evidence.physical_line_start ?? record(evidence.start).line_start)
  const end = text(evidence.physical_line_end ?? record(evidence.end).line_end)
  return start && end ? t('rowRange', { start, end }) : ''
}

export function Section({ title, meta, children, headingRef }: { title: string; meta?: string; children: ReactNode; headingRef?: Ref<HTMLHeadingElement> }) {
  return <section className={css.section}>
    <div className={css.sectionHeading}><h2 ref={headingRef} tabIndex={headingRef === undefined ? undefined : -1}>{title}</h2>{meta && <p>{meta}</p>}</div>
    {children}
  </section>
}

export function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return <div className={css.stat}>
    <div className={css.statLabel}>{label}</div>
    <div className={css.statValue}>{value}</div>
    {note && <div className={css.caption}>{note}</div>}
  </div>
}

export function FileLink({ fileUrl, path, children }: { fileUrl: ResultProps['fileUrl']; path: unknown; children: ReactNode }) {
  const href = fileUrl(text(path))
  return href ? <a className={css.link} href={href} target="_blank" rel="noreferrer">{children}</a> : null
}

export function QueryError({ t, error, retry, retained = false }: { t: Translate; error: string; retry: () => void; retained?: boolean }) {
  return <div role="alert" className={retained ? css.update : css.empty}>
    <strong>{t(retained ? 'refreshFailed' : 'failed')}</strong>{error && <p>{error}</p>}
    <button type="button" className={css.secondary} onClick={retry}>{t('retry')}</button>
  </div>
}
