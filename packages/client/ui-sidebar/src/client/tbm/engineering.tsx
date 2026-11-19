import { useEffect, useMemo, useRef, useState } from 'react'
import { numeric, record, rows, text, type Data } from './contracts.ts'
import { continueInChat, duration, evidenceLabel, number, percent, QueryError, Section, Stat, timestamp, windowLabel, type ResultProps, type Translate } from './display.tsx'
import { Trends } from './trends.tsx'
import css from './TbmPanel.module.css'

function StopDetails(props: ResultProps & { day: Data }) {
  const { day, t } = props
  const downtime = record(day.downtime)
  const stops = rows(downtime.intervals).sort((left, right) => (numeric(right.seconds) ?? 0) - (numeric(left.seconds) ?? 0))
  const gaps = rows(downtime.unobserved_intervals)
  const [visible, setVisible] = useState(5)
  const cutoff = timestamp(day.cutoff)
  const source = record(day.evidence)
  return <div className={css.dayBody}>
    <div className={css.summaryLine}>
      <span>{t('duration')} · <strong>{duration(downtime.seconds, t)}</strong></span>
      {cutoff && <span>{t('cutoff')} · {cutoff}</span>}
      {text(source.zip) && <span>{t('archive')} · {text(source.zip)}</span>}
    </div>
    <h3>{t('stopSegments')} · {stops.length}</h3>
    {stops.length === 0 ? <p className={css.caption}>{t('noStops')}</p> : <div className={css.events}>
      {stops.slice(0, visible).map(stop => {
        const start = timestamp(stop.start)
        const end = timestamp(stop.end)
        const time = t('dateRange', { start, end })
        const length = duration(stop.seconds, t)
        const line = evidenceLabel(record(stop.evidence), t)
        const reason = [text(stop.reason), text(stop.end_label)].filter(Boolean).join(' · ')
        const date = start.slice(0, 10)
        const startTime = start.slice(11, 19)
        const endTime = end.slice(0, 10) === date ? end.slice(11, 19) : '24:00'
        return <div className={css.event} key={`${start}-${end}`}>
          <div><strong>{length}</strong><p>{time}</p>{(reason || line) && <p className={css.caption}>{[reason, line].filter(Boolean).join(' · ')}</p>}</div>
          <div className={css.actions}>
            <button type="button" className={css.secondary} disabled={!start || end <= start}
              onClick={() => { props.openConditions({ date, start_time: startTime, end_time: endTime }) }}>
              {t('openConditions')}
            </button>
            <button type="button" className={css.secondary} onClick={() => { continueInChat(props, [t('stopSegments'), time, `${t('duration')} ${length}`, reason, line]) }}>
              {t('openDraft')}
            </button>
          </div>
        </div>
      })}
      {visible < stops.length && <button className={css.secondary} type="button" onClick={() => { setVisible(visible + 10) }}>{t('showStops', { count: String(Math.min(10, stops.length - visible)) })}</button>}
    </div>}
    <details className={css.details}>
      <summary>{t('gaps')} · {gaps.length}</summary>
      {gaps.length === 0 ? <p className={css.caption}>{t('noGaps')}</p> : <>
        {gaps.length > 12 && <p className={css.caption}>{t('listedGaps', { count: '12', total: String(gaps.length) })}</p>}
        <ul>{gaps.slice(0, 12).map((gap, index) => {
          const start = timestamp(gap.missing_record_start ?? gap.start)
          const end = timestamp(gap.end)
          return <li key={`${start}-${end}-${index}`}>{t('dateRange', { start, end })} · {duration(gap.missing_record_seconds ?? gap.seconds, t)}</li>
        })}</ul>
      </>}
    </details>
  </div>
}

const DISTRIBUTION = ['excavating', 'stopped', 'other', 'undetermined'] as const

function DistributionRing({ data, t }: { data: Data; t: Translate }) {
  const fractions = record(data.fractions)
  let offset = 0
  return <div className={css.ringLayout}>
    <figure className={css.ring} aria-label={t('timeMix')}>
      <svg viewBox="0 0 120 120" aria-hidden="true">
        <circle cx="60" cy="60" r="48" className={css.ringTrack} />
        {DISTRIBUTION.map(key => {
          const value = Math.max(0, Math.min(100, (numeric(fractions[key]) ?? 0) * 100))
          const start = offset
          offset += value
          return value > 0 && <circle key={key} cx="60" cy="60" r="48" pathLength="100" data-tone={key} strokeDasharray={`${value} ${100 - value}`} strokeDashoffset={-start} />
        })}
      </svg>
      <div><strong>{percent(fractions.excavating)}</strong><span>{t('excavating')}</span></div>
    </figure>
    <ul className={css.legend}>
      {DISTRIBUTION.map(key => <li key={key}><i data-tone={key} /><span>{t(key)}</span><strong>{percent(fractions[key])}</strong></li>)}
    </ul>
  </div>
}

function AdvanceBars({ days, selectedDate, selectDate, canSelectDate, t }: Pick<ResultProps, 't' | 'selectedDate' | 'selectDate' | 'canSelectDate'> & { days: Data[] }) {
  const [cumulative, setCumulative] = useState(false)
  const mode = cumulative ? 'cumulativeAdvance' : 'weeklyBars'
  const values = days.map(item => numeric(cumulative ? item.cumulative_advance : item.advance))
  const max = Math.max(0, ...values.map(value => value ?? 0))
  const min = Math.min(0, ...values.map(value => value ?? 0))
  const span = max - min || 1
  const zero = max / span * 100
  return <>
    <div className={css.chartControl}>
      <button className={css.chip} type="button" aria-pressed={!cumulative} onClick={() => { setCumulative(false) }}>{t('daily')}</button>
      <button className={css.chip} type="button" aria-pressed={cumulative} onClick={() => { setCumulative(true) }}>{t('cumulative')}</button>
      <span className={css.caption}>{t('unknownUnit')}</span>
    </div>
    <div className={css.bars} aria-label={t(mode)}>
      {days.map((item, index) => {
        const date = text(item.date)
        const value = values[index]
        const height = value === undefined ? 0 : Math.abs(value) / span * 100
        const label = `${date} · ${t(mode)} ${number(value)}`
        return <button className={css.barButton} type="button" key={date} aria-pressed={date === selectedDate}
          disabled={!canSelectDate(date)} aria-label={label} title={label} onClick={event => { selectDate(date, event.currentTarget) }}>
          <span className={css.barValue}>{number(value)}</span>
          <span className={css.barTrack}>
            <span className={css.baseline} style={{ top: `${zero}%` }} />
            {value !== undefined && value !== 0 && <span className={css.signedBar} style={{ top: `${value > 0 ? zero - height : zero}%`, height: `${height}%` }} />}
          </span>
          <span className={css.barDate}>{date.slice(5)}</span>
        </button>
      })}
    </div>
  </>
}

function DailyDistribution({ days, selectedDate, selectDate, canSelectDate, t }: Pick<ResultProps, 't' | 'selectedDate' | 'selectDate' | 'canSelectDate'> & { days: Data[] }) {
  const distribution = days.map(item => record(item.distribution))
  const scale = Math.max(1, ...distribution.map(item => numeric(item.denominator_seconds) ?? 0))
  return <>
    <div className={css.bars} aria-label={t('dailyMix')}>
      {days.map((item, index) => {
        const date = text(item.date)
        const day = distribution[index]!
        const stopped = numeric(day.stopped_seconds)
        const label = `${date} · ${DISTRIBUTION.map(key => `${t(key)} ${duration(day[`${key}_seconds`], t)}`).join(' · ')}`
        return <button className={css.barButton} type="button" key={date} aria-pressed={date === selectedDate}
          disabled={!canSelectDate(date)} aria-label={label} title={label} onClick={event => { selectDate(date, event.currentTarget) }}>
          <span className={css.barValue}>{stopped === undefined ? '—' : t('hourValue', { value: number(stopped / 3600) })}</span>
          <span className={css.stackTrack} aria-hidden="true">
            {DISTRIBUTION.map(key => <span key={key} data-tone={key} style={{ height: `${(numeric(day[`${key}_seconds`]) ?? 0) / scale * 100}%` }} />)}
          </span>
          <span className={css.barDate}>{date.slice(5)}</span>
        </button>
      })}
    </div>
    <ul className={css.inlineLegend}>{DISTRIBUTION.map(key => <li key={key}><i data-tone={key} />{t(key)}</li>)}</ul>
  </>
}

export function Progress(props: ResultProps) {
  const { result, t, detail, selectedDate, selectDate } = props
  const dayHeading = useRef<HTMLHeadingElement>(null)
  const detailDate = detail?.date
  useEffect(() => {
    if (!detailDate) return
    dayHeading.current?.scrollIntoView({ block: 'nearest' })
    dayHeading.current?.focus({ preventScroll: true })
  }, [detailDate])
  const data = result.data
  const days = rows(data.days)
  if (days.length === 0) return <p className={css.empty}>{t('empty')}</p>
  const totals = record(data.totals)
  const distribution = record(totals.distribution)
  const window = t('dateRange', { start: text(days[0]?.date), end: text(days.at(-1)?.date) })
  const advance = number(totals.advance)
  const stops = duration(totals.downtime_seconds, t)
  const observed = `${number(totals.observed_days)} / ${days.length} ${t('days')}`
  const day = detail?.result?.data
  return <div className={css.content}>
    <div className={css.stats}>
      <Stat label={t('chainageAdvance')} value={advance} note={t('unknownUnit')} />
      <Stat label={t('weeklyStops')} value={stops} note={t('classifiedOnly')} />
      <Stat label={t('coverage')} value={observed} note={window} />
    </div>
    <div className={css.chartGrid}>
      <Section title={t('advanceChart')} meta={window}><AdvanceBars {...props} days={days} /></Section>
      <Section title={t('timeMix')}>
        <DistributionRing data={distribution} t={t} />
        <p className={css.caption}>{t('timeBasis')}</p>
      </Section>
    </div>
    <Section title={t('dailyMix')} meta={t('dailyMixNote')}>
      <DailyDistribution {...props} days={days} />
      <div className={css.sectionFoot}>
        <button className={css.secondary} type="button" onClick={event => { selectDate(selectedDate, event.currentTarget) }}>{t('openDay')}</button>
        <button className={css.secondary} type="button" onClick={() => { continueInChat(props, [window, `${t('chainageAdvance')} ${advance} · ${t('unknownUnit')}`, `${t('weeklyStops')} ${stops}`, `${t('excavating')} ${percent(record(distribution.fractions).excavating)} · ${t('timeBasis')}`]) }}>{t('openDraft')}</button>
      </div>
    </Section>
    {detail && <Section title={t('dayDetail')} meta={detail.date} headingRef={dayHeading}>
      <button className={css.secondary} type="button" onClick={detail.close}>{t('closeDetail')}</button>
      {detail.pending && <p role="status" className={css.caption}>{t('readingDay')}</p>}
      {detail.error !== undefined && <QueryError t={t} error={detail.error} retry={detail.retry} />}
      {day && <StopDetails key={detail.date} {...props} day={day} />}
    </Section>}
  </div>
}

function metricEntries(value: unknown): [string, Data][] {
  return Object.entries(record(value)).map(([key, item]) => {
    const metric = record(item)
    return [text(record(metric.evidence).field) || key, metric]
  })
}

function LimitDetails({ events, limits, props }: { events: { point: Data; event: Data }[]; limits: Data; props: ResultProps }) {
  const { t, focusLimits } = props
  const target = useRef<HTMLDetailsElement>(null)
  const [visible, setVisible] = useState(12)
  const [expanded, setExpanded] = useState(false)
  const series = useMemo(() => rows(limits.series), [limits.series])
  useEffect(() => {
    if (!focusLimits) return
    target.current?.scrollIntoView({ block: 'start' })
    target.current?.querySelector('summary')?.focus({ preventScroll: true })
  }, [focusLimits])
  return <details className={css.detailsCard} open={focusLimits || undefined} onToggle={event => { setExpanded(event.currentTarget.open) }} ref={target}>
    <summary>{t('conditionsLimits')} · {events.length}</summary>
    {(expanded || focusLimits) && series.length > 0 && <Trends series={series} window={record(limits.window)}
      sampling={record(limits.sampling)} t={t} />}
    {events.length === 0 ? <p className={css.caption}>{t('noLimits')}</p> : <div className={css.events}>
      {events.slice(0, visible).map(({ point, event }, index) => {
        const span = t('dateRange', { start: timestamp(event.start), end: timestamp(event.end) })
        const title = text(event.point ?? point.point ?? point.field)
        const length = duration(event.duration_seconds ?? event.seconds, t)
        const peak = record(event.peak)
        const values = numeric(peak.value) === undefined ? '' : `${t('measured')} ${number(peak.value)} · ${t('threshold')} ${number(peak.setpoint)}`
        const level = event.level === 'alarm' || event.level === 'warning' ? t(event.level) : ''
        const facts = [title, level, span, length, values, text(event.end_label)]
        return <div className={css.event} key={`${title}-${span}-${index}`}>
          <div><strong>{title || t('events')}{level && ` · ${level}`}</strong><p>{span} · {length}</p><p className={css.caption}>{[values, text(event.end_label)].filter(Boolean).join(' · ')}</p></div>
          <button className={css.secondary} type="button" onClick={() => { continueInChat(props, facts) }}>{t('openDraft')}</button>
        </div>
      })}
      {visible < events.length && <button className={css.secondary} type="button" onClick={() => { setVisible(visible + 12) }}>{t('showStops', { count: String(Math.min(12, events.length - visible)) })}</button>}
    </div>}
  </details>
}

export function Conditions(props: ResultProps) {
  const { result, t } = props
  const data = record(result.data.conditions)
  const limits = record(result.data.limits)
  const series = useMemo(() => rows(data.series), [data.series])
  const metrics = metricEntries(data.metrics)
  const limitEvents = rows(limits.points).flatMap(point => rows(point.events).map(event => ({ point, event })))
  const start = timestamp(data.actual_start)
  const end = timestamp(data.actual_end)
  const window = start && end ? t('dateRange', { start, end }) : windowLabel(data.window, t)
  const records = number(data.record_count)
  const distribution = record(data.distribution ?? result.data.distribution)
  const alarm = limitEvents.filter(({ event }) => event.level === 'alarm').length
  const warning = limitEvents.filter(({ event }) => event.level === 'warning').length
  if (numeric(data.record_count) === 0 || (metrics.length === 0 && series.length === 0)) return <p className={css.empty}>{t('empty')}</p>
  return <div className={css.content}>
    <div className={css.stats}>
      <Stat label={t('observations')} value={records} note={t('coverage')} />
      <Stat label={t('running')} value={duration(distribution.running_seconds, t)} note={t('runningBasis')} />
      <Stat label={t('conditionsLimits')} value={number(limitEvents.length)} note={t('limitCounts', { warning: String(warning), alarm: String(alarm) })} />
    </div>
    <Section title={t('trend')} meta={window}>
      <Trends key={windowLabel(data.window, t)} series={series} window={record(data.window)} sampling={record(data.sampling)} t={t} />
      <div className={css.sectionFoot}>
        <span className={css.caption}>{t('trendNote')}</span>
        <button className={css.secondary} type="button" onClick={() => { continueInChat(props, [window, `${t('observations')} ${records}`, ...metrics.map(([key, item]) => `${key} ${t('average')} ${number(item.mean)} ${text(item.unit)}`), evidenceLabel(record(data.evidence), t)]) }}>{t('openDraft')}</button>
      </div>
    </Section>
    <LimitDetails key={window} events={limitEvents} limits={limits} props={props} />
    {metrics.length > 0 && <details className={css.detailsCard}><summary>{t('metricDetails')}</summary>
      <div className={css.tableScroll}>
        <table><thead><tr><th>{t('field')}</th><th>{t('average')}</th><th>{t('minimum')}</th><th>{t('maximum')}</th></tr></thead>
          <tbody>{metrics.map(([key, item]) => <tr key={key}><th scope="row">{key} {text(item.unit)}</th><td>{number(item.mean)}</td><td>{number(item.min)}</td><td>{number(item.max)}</td></tr>)}</tbody>
        </table>
      </div>
    </details>}
  </div>
}

