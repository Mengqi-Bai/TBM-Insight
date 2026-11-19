import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import type { InjectFace, PropsLocale } from '@tbm-insight/client-ui-slots'
import { numeric, record, strings, text, type Filters, type PanelInjected } from './contracts.ts'
import { Conditions, Progress } from './engineering.tsx'
import { Cutters, Evidence, StandardLibrary } from './reference.tsx'
import { QueryError, sourceLabel, type DayDetail } from './display.tsx'
import css from './TbmPanel.module.css'

type TbmPanelProps = InjectFace<PanelInjected> & PropsLocale<'tbmPanels'>
type EvidenceMode = NonNullable<Filters['evidence_mode']>

const VIEWS = { progress: Progress, conditions: Conditions, cutters: Cutters, evidence: Evidence } as const

function figureProperties(value: unknown): CSSProperties {
  const style = record(value)
  const fonts = strings(style.fonts)
  const width = numeric(style.line_width)
  const properties: Record<string, string> = {}
  if (fonts.length) properties['--tbm-figure-fonts'] = `${fonts.map(font => JSON.stringify(font)).join(', ')}, serif`
  if (width !== undefined) properties['--tbm-figure-line-width'] = `${width}px`
  if (text(style.frame_color)) properties['--tbm-figure-frame'] = text(style.frame_color)
  for (const name of ['measured', 'estimated', 'warning', 'alarm', 'excavating', 'stopped', 'other', 'undetermined', 'repeated']) {
    const color = text(record(style.colors)[name])
    if (color) properties[`--tbm-figure-${name}`] = color
  }
  for (const name of ['warning', 'alarm']) {
    const dash = text(record(style.dash_patterns)[name])
    if (dash) properties[`--tbm-figure-dash-${name}`] = dash
  }
  return properties as CSSProperties
}

interface Resource<T, K> {
  readonly success?: { readonly request: K; readonly value: T }
  readonly failure?: { readonly request: K; readonly error: string }
}

function useResource<T, K>(
  request: K | undefined,
  load: (request: K, signal: AbortSignal) => Promise<T>,
  peek?: (request: K) => T | undefined,
) {
  const [resource, setResource] = useState<Resource<T, K>>({})
  const [attempt, setAttempt] = useState(0)
  const cached = request === undefined ? undefined : peek?.(request)
  useEffect(() => {
    if (request === undefined || cached !== undefined) return
    const controller = new AbortController()
    void load(request, controller.signal).then(value => {
      if (!controller.signal.aborted) setResource({ success: { request, value } })
    }, error => {
      if (!controller.signal.aborted) setResource(previous => ({
        ...previous, failure: { request, error: error instanceof Error ? error.message : '' },
      }))
    })
    return () => { controller.abort() }
  }, [attempt, cached, load, request])
  const retry = useCallback(() => {
    setResource(previous => previous.success === undefined ? {} : { success: previous.success })
    setAttempt(previous => previous + 1)
  }, [])
  const success = cached !== undefined && request !== undefined ? { request, value: cached } : resource.success
  const failure = resource.failure?.request === request ? resource.failure : undefined
  return {
    success,
    failure,
    pending: request !== undefined && success?.request !== request && failure === undefined,
    retry,
  }
}

function weekFor(date: string) {
  const start = new Date(`${date}T00:00:00Z`)
  start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7))
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 7)
  return { start_date: start.toISOString().slice(0, 10), end_date: end.toISOString().slice(0, 10) }
}

function dateGroups(dates: readonly string[]) {
  const groups = new Map<string, string[]>()
  for (const date of [...new Set(dates)].filter(value => /^\d{4}-\d{2}-\d{2}$/u.test(value)).sort().reverse()) {
    const month = date.slice(0, 7)
    const group = groups.get(month)
    if (group) group.push(date)
    else groups.set(month, [date])
  }
  return groups
}

export function TbmPanel(props: TbmPanelProps) {
  const { t, panel, useViewing } = props
  const range = useViewing(value => value.conditionRange)
  const lastWeek = useViewing(value => value.week)
  const progressDate = useViewing(value => value.progressDate)
  const sourceRevision = useViewing(value => value.sourceRevision) ?? 0
  const initial = panel === 'conditions' ? range : undefined
  const key = initial === undefined ? '' : `${initial.date}-${initial.start_time ?? ''}-${initial.end_time ?? ''}-${initial.focus ?? ''}`
  return <main className={css.panel} data-tbm-panel={panel}>
    <div className={css.sheet}>
      <header className={css.hero}>
        <h1>{t(panel)}</h1>
        <span className={css.source} data-origin={panel === 'evidence' ? 'knowledge_index' : 'historical'}>
          <span aria-hidden="true" />{sourceLabel(panel === 'evidence' ? 'knowledge_index' : 'historical', t)}
        </span>
      </header>
      <div className={css.body}>
        <PanelQuery key={`${sourceRevision}:${key}`} {...props} range={initial} lastWeek={lastWeek} progressDate={progressDate} />
      </div>
    </div>
  </main>
}

type PanelQueryProps = TbmPanelProps & {
  readonly range: Parameters<PanelInjected['openConditions']>[0] | undefined
  readonly lastWeek: Parameters<PanelInjected['rememberWeek']>[0] | undefined
  readonly progressDate: string | undefined
}

function PanelQuery({
  panel, t, range, lastWeek, progressDate, options, load, peekOptions, peekResult, peekQuery, rememberQuery,
  rememberWeek, fileUrl, openConditions, openDraft,
}: PanelQueryProps) {
  const [previousQuery] = useState(() => peekQuery?.())
  const [optionAttempt, setOptionAttempt] = useState(0)
  const [dateChoice, setDateChoice] = useState('')
  const [detailOpen, setDetailOpen] = useState(false)
  const detailTrigger = useRef<HTMLElement | null>(null)
  const [evidenceRequest, setEvidenceRequest] = useState(panel === 'evidence' ? previousQuery : undefined)
  const [query, setQuery] = useState(previousQuery?.query ?? '')
  const [region, setRegion] = useState(previousQuery?.region ?? '')
  const [evidenceMode, setEvidenceMode] = useState<EvidenceMode>(previousQuery?.evidence_mode ?? 'auto')

  const optionLoad = useMemo(() => (_attempt: number, signal: AbortSignal) => options(signal), [options])
  const availability = useResource(optionAttempt, optionLoad, peekOptions)
  const available = availability.success?.value
  const groups = useMemo(() => dateGroups(available?.dates ?? []), [available])
  const dates = useMemo(() => new Set([...groups.values()].flat()), [groups])
  const weekDate = panel === 'cutters' && lastWeek !== undefined
    ? [...dates].find(value => value >= lastWeek.start_date && value < lastWeek.end_date)
    : undefined
  const preferredDate = previousQuery?.date ?? range?.date ?? (panel === 'progress' ? progressDate : weekDate) ?? ''
  const defaultDate = dates.has(preferredDate) ? preferredDate
    : dates.has(available?.defaultDate ?? '') ? available!.defaultDate : [...dates][0] ?? ''
  const date = dates.has(dateChoice) ? dateChoice : defaultDate
  const weekStart = date && (panel === 'progress' || panel === 'cutters') ? weekFor(date).start_date : ''
  const selectedRequest = useMemo<Filters | undefined>(() => {
    if (!weekStart) return undefined
    return panel === 'progress' ? { date: weekStart, detail: 'week' } : weekFor(weekStart)
  }, [panel, weekStart])
  const conditionRequest = useMemo<Filters | undefined>(() => {
    if (panel !== 'conditions' || !date) return undefined
    if (dateChoice === '' && previousQuery?.date === date) return previousQuery
    return {
      date,
      ...(range?.date === date && dateChoice === '' && range.start_time ? { start_time: range.start_time } : {}),
      ...(range?.date === date && dateChoice === '' && range.end_time ? { end_time: range.end_time } : {}),
    }
  }, [date, dateChoice, panel, previousQuery, range])
  const request = panel === 'evidence' ? evidenceRequest : panel === 'conditions' ? conditionRequest : selectedRequest
  const results = useResource(request, load, peekResult)
  const dayRequest = useMemo<Filters | undefined>(() => panel === 'progress' && date && detailOpen ? { date, detail: 'day' } : undefined, [date, detailOpen, panel])
  const day = useResource(dayRequest, load, peekResult)

  const week = record(results.success?.value.data.window)
  const start = text(week.start)
  const end = text(week.end)
  const current = results.success?.request === request
  useEffect(() => {
    if (panel === 'progress' && current && start && end && date) rememberWeek({ start_date: start, end_date: end }, date)
  }, [current, date, end, panel, rememberWeek, start])
  useEffect(() => {
    if (current && request !== undefined && (panel === 'conditions' || panel === 'evidence')) rememberQuery?.(request)
  }, [current, panel, rememberQuery, request])
  const indexing = current && results.success?.value.status === 'index_pending'
  useEffect(() => {
    if (!indexing || results.failure !== undefined) return
    const timer = setTimeout(results.retry, 1500)
    return () => { clearTimeout(timer) }
  }, [indexing, results.failure, results.retry, results.success?.value])

  const selectDate = (value: string, trigger?: HTMLElement) => {
    if (!dates.has(value)) return
    setDateChoice(value)
    if (panel === 'progress') {
      detailTrigger.current = trigger ?? null
      setDetailOpen(true)
    }
  }
  const search = (value: string) => {
    const question = value.trim()
    if (!question || available === undefined) return
    setQuery(question)
    setEvidenceRequest({ query: question, evidence_mode: evidenceMode, ...(region ? { region } : {}) })
  }
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (panel === 'evidence') search(query)
  }

  const result = results.success?.value
  const View = VIEWS[panel]
  const detail: DayDetail | undefined = dayRequest === undefined ? undefined : {
    date,
    pending: day.pending,
    result: day.success?.request === dayRequest ? day.success.value : undefined,
    error: day.failure?.error,
    retry: day.retry,
    close: () => { setDetailOpen(false); detailTrigger.current?.focus() },
  }
  return <>
    <form className={css.filters} onSubmit={submit}>
      {panel === 'evidence' ? <>
        <label className={css.query}><span>{t('query')}</span><input type="search" required value={query} placeholder={t('searchPrompt')} onChange={event => { setQuery(event.target.value) }} /></label>
        <label><span>{t('evidenceMode')}</span>
          <select value={evidenceMode} onChange={event => { setEvidenceMode(event.target.value as EvidenceMode) }}>
            {(['auto', 'standard', 'case', 'both'] as const).map(value => <option key={value} value={value}>{t(value)}</option>)}
          </select>
        </label>
        <label><span>{t('region')}</span><select value={region} disabled={available === undefined} onChange={event => { setRegion(event.target.value) }}>
          <option value="">{t('anyRegion')}</option>
          {available?.regions.map(value => <option key={value} value={value}>{value}</option>)}
        </select></label>
        <button type="submit" className={css.primary} disabled={available === undefined}>{t('search')}</button>
      </> : <>
        <label><span>{t('date')}</span><select value={date} disabled={!date} onChange={event => { selectDate(event.target.value, event.currentTarget) }}>
          {!date && <option value="">{t(available === undefined ? 'datesLoading' : 'noDates')}</option>}
          {[...groups].map(([month, entries]) => <optgroup key={month} label={month}>{entries.map(value => <option key={value} value={value}>{value}</option>)}</optgroup>)}
        </select></label>
      </>}
    </form>
    {panel === 'evidence' && <div className={css.chips}>
      {(['queryBolts', 'queryCoal', 'queryStuck'] as const).map(key => <button className={css.chip} type="button" key={key} disabled={available === undefined} onClick={() => { search(t(key)) }}>{t(key)}</button>)}
      {request !== undefined && <button type="button" className={css.secondary} onClick={() => {
        setEvidenceRequest(undefined)
        rememberQuery?.(undefined)
      }}>{t('returnLibrary')}</button>}
    </div>}
    {range && available && date && !dates.has(range.date) && <p role="status" className={css.update}>{t('unavailableDate', { date: range.date })}</p>}
    <div className={css.results} style={figureProperties(result?.data.figure_style)} aria-busy={availability.pending || results.pending}>
      {availability.pending && <p role="status" className={css.empty}>{t('datesLoading')}</p>}
      {availability.failure && <QueryError t={t} error={availability.failure.error} retry={() => { setOptionAttempt(value => value + 1) }} />}
      {available !== undefined && request === undefined && (panel === 'evidence'
        ? <StandardLibrary documents={available.documents ?? []} t={t} fileUrl={fileUrl} />
        : <p className={css.empty}>{t('noDates')}</p>)}
      {results.pending && <p role="status" className={result === undefined ? css.empty : css.update}>{t(result === undefined ? 'working' : 'refreshing')}</p>}
      {indexing && results.failure === undefined && <p role="status" className={css.update}>{t('indexing')}</p>}
      {results.failure && <QueryError t={t} error={results.failure.error} retry={results.retry} retained={result !== undefined} />}
      {result !== undefined && (panel !== 'evidence' || request !== undefined) && <View result={result} t={t} selectedDate={date} selectDate={selectDate} canSelectDate={value => dates.has(value)}
        detail={detail} focusLimits={range?.focus === 'limits' && range.date === results.success?.request.date}
        openConditions={openConditions} openDraft={openDraft} fileUrl={fileUrl} />}
    </div>
  </>
}
