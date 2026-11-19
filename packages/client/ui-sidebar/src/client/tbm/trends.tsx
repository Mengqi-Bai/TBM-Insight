import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { numeric, rows, text, type Data } from './contracts.ts'
import { number, type Translate } from './display.tsx'
import css from './TbmPanel.module.css'

interface Sample {
  readonly second: number
  readonly value: number | undefined
}

interface TimeRange {
  readonly first: number
  readonly last: number
}

const PLOT_WIDTH = 640
const PLOT_HEIGHT = 72
const MIN_SPAN = 10

function seconds(value: unknown): number {
  const timestamp = text(value)
  const instant = /(?:[+-]\d{2}:?\d{2}|Z)$/u.test(timestamp) ? timestamp : `${timestamp}Z`
  return Math.floor(Date.parse(instant) / 1000)
}

function clock(second: number): string {
  return new Date(second * 1000).toISOString().slice(11, 19)
}

function getPoints(value: unknown): Sample[] {
  return !Array.isArray(value) ? [] : value.flatMap(point => {
    if (!Array.isArray(point)) return []
    const second = seconds(point[0])
    return Number.isFinite(second) ? [{ second, value: numeric(point[1]) }] : []
  })
}

function getPlot(series: Data) {
  const points = getPoints(series.points)
  const settings = rows(series.settings).flatMap(item => {
    const level = item.level
    return level === 'warning' || level === 'alarm' ? [{ level, label: text(item.label), points: getPoints(item.points) }] : []
  })
  let min = Infinity
  let max = -Infinity
  for (const point of points) {
    if (point.value === undefined) continue
    min = Math.min(min, point.value)
    max = Math.max(max, point.value)
  }
  let lower = min
  let upper = max
  for (const { points } of settings) {
    for (const point of points) {
      if (point.value === undefined) continue
      lower = Math.min(lower, point.value)
      upper = Math.max(upper, point.value)
    }
  }
  const padding = lower === upper ? Math.max(0.01, Math.abs(lower) * 0.05) : 0
  const finite = Number.isFinite(lower)
  return {
    key: text(series.key ?? series.field),
    title: [text(series.label ?? series.field ?? series.key), text(series.unit)].filter(Boolean).join(' · '),
    points, settings,
    min,
    max,
    lower: finite ? lower - padding : 0,
    upper: finite ? upper + padding : 1,
  }
}

function firstAtOrAfter(points: readonly Sample[], second: number): number {
  let first = 0
  let last = points.length
  while (first < last) {
    const middle = Math.floor((first + last) / 2)
    if (points[middle]!.second < second) first = middle + 1
    else last = middle
  }
  return first
}

function readingAt(points: readonly Sample[], second: number, maxSpan: number) {
  const index = firstAtOrAfter(points, second)
  const next = points[index]
  if (next?.second === second && next.value !== undefined) return { quality: 'sampleObserved', value: next.value } as const
  const previous = points[index - 1]
  if (previous?.value !== undefined && next?.value !== undefined && next.second - previous.second <= maxSpan) {
    const ratio = (second - previous.second) / (next.second - previous.second)
    return { quality: 'sampleEstimated', value: previous.value + ratio * (next.value - previous.value) } as const
  }
  return { quality: 'sampleMissing', value: undefined } as const
}

function xAt(second: number, view: TimeRange): number {
  return (second - view.first) / Math.max(1, view.last - view.first) * PLOT_WIDTH
}

function getPath(plot: ReturnType<typeof getPlot>, view: TimeRange, maxSpan: number,
  points = plot.points, stepped = false): string {
  const first = Math.max(0, firstAtOrAfter(points, view.first) - 1)
  const last = firstAtOrAfter(points, view.last + 1) + 1
  let previous: Sample | undefined
  return points.slice(first, last).map(point => {
    if (point.value === undefined) { previous = undefined; return '' }
    const connected = previous !== undefined && point.second - previous.second <= maxSpan
    previous = point
    const x = xAt(point.second, view).toFixed(2)
    const y = (67 - (point.value - plot.lower) / (plot.upper - plot.lower) * 62).toFixed(2)
    if (!connected) return `M${x} ${y}h.01`
    return stepped ? `H${x}V${y}` : `L${x} ${y}`
  }).join(' ')
}

function clamp(value: number, first: number, last: number): number {
  return Math.min(last, Math.max(first, value))
}

function TrendPlot({ plot, view, cursor, maxSpan, select, t }: {
  plot: ReturnType<typeof getPlot>; view: TimeRange; cursor: number | undefined
  maxSpan: number; select: (second: number) => void; t: Translate
}) {
  const path = useMemo(() => getPath(plot, view, maxSpan), [plot, view, maxSpan])
  const settings = useMemo(() => plot.settings.map(item => ({
    ...item, path: getPath(plot, view, Infinity, item.points, true),
  })), [plot, view])
  const reading = cursor === undefined ? undefined : readingAt(plot.points, cursor, maxSpan)
  const caption = cursor === undefined || reading === undefined
    ? Number.isFinite(plot.min) ? `${number(plot.min)} – ${number(plot.max)}` : t('sampleMissing')
    : t('cursorValue', { time: clock(cursor), value: number(reading.value), quality: t(reading.quality) })
  return <figure className={css.trend}>
    <figcaption>{plot.title}<span>{caption}</span></figcaption>
    <div className={css.trendGrid}>
      <div className={css.valueTicks} role="group" aria-label={t('valueAxis')}>
        {[plot.upper, (plot.upper + plot.lower) / 2, plot.lower].map((value, index) => <span key={index}>{number(value)}</span>)}
      </div>
      <div className={css.plotFrame}>
        {settings.length > 0 && <ul className={css.plotLegend}>
          <li data-trace="measured">{t('measured')}</li>
          {settings.map(item => <li key={item.level} data-trace={item.level}>{item.label}</li>)}
        </ul>}
        <svg data-tbm-trend-plot="" role="img" aria-label={`${plot.title} · ${t('trend')}`} viewBox="0 0 640 72" preserveAspectRatio="none"
          onPointerMove={event => {
            if (event.pointerType === 'touch') return
            const bounds = event.currentTarget.getBoundingClientRect()
            if (bounds.width <= 0) return
            const position = clamp((event.clientX - bounds.left) / bounds.width, 0, 1)
            select(Math.round(view.first + position * (view.last - view.first)))
          }}>
          <path className={css.trendline} d={path} vectorEffect="non-scaling-stroke" />
          {settings.map(item => <path key={item.level} className={css.trendline} data-trace={item.level} d={item.path} vectorEffect="non-scaling-stroke" />)}
          {cursor !== undefined && <line className={css.cursorLine} x1={xAt(cursor, view)} x2={xAt(cursor, view)} y1="0" y2={PLOT_HEIGHT} vectorEffect="non-scaling-stroke" />}
        </svg>
      </div>
    </div>
  </figure>
}

export function Trends({ series, window, sampling, t }: { series: Data[]; window: Data; sampling: Data; t: Translate }) {
  const [viewing, setViewing] = useState<{ cursor: number | undefined; zoom: TimeRange | undefined }>({ cursor: undefined, zoom: undefined })
  const { cursor, zoom } = viewing
  const container = useRef<HTMLDivElement>(null)
  const plots = useMemo(() => series.map(getPlot), [series])
  const first = seconds(window.start)
  const last = seconds(window.end) - 1
  const full = useMemo(() => ({ first, last }), [first, last])
  const hasTrends = plots.length > 0 && last >= first
  const zoomAt = useCallback((factor: number, pointer?: number) => {
    setViewing(previous => {
      const view = previous.zoom ?? full
      const span = view.last - view.first
      if (span <= 0) return previous
      const position = pointer ?? (previous.cursor === undefined ? 0.5 : (previous.cursor - view.first) / span)
      const anchor = view.first + span * position
      const fullSpan = full.last - full.first
      const nextSpan = Math.min(fullSpan, Math.max(MIN_SPAN, Math.round(span * factor)))
      const start = clamp(Math.round(anchor - nextSpan * position), full.first, full.last - nextSpan)
      return { cursor: Math.round(anchor), zoom: nextSpan === fullSpan ? undefined : { first: start, last: start + nextSpan } }
    })
  }, [full])
  useEffect(() => {
    const target = container.current
    if (!hasTrends || !target) return
    const handleWheel = (event: WheelEvent) => {
      if (!event.deltaY || event.ctrlKey || event.metaKey || !(event.target instanceof Element)) return
      const plot = event.target.closest('[data-tbm-trend-plot]')
      if (!plot) return
      const bounds = plot.getBoundingClientRect()
      if (bounds.width <= 0) return
      event.preventDefault()
      const pointer = clamp((event.clientX - bounds.left) / bounds.width, 0, 1)
      const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 3 : event.deltaMode === WheelEvent.DOM_DELTA_PAGE ? 1 : 100
      zoomAt(0.75 ** clamp(-event.deltaY / unit, -3, 3), pointer)
    }
    target.addEventListener('wheel', handleWheel, { passive: false })
    return () => { target.removeEventListener('wheel', handleWheel) }
  }, [hasTrends, zoomAt])
  if (!hasTrends) return <p className={css.caption}>{t('empty')}</p>
  const maxSpan = numeric(sampling.bucket_seconds) ?? 1
  const view = zoom ?? full
  const span = view.last - view.first
  const activeCursor = cursor ?? (span === 0 ? view.first : undefined)
  return <div className={css.trends} ref={container}>
    <div className={css.trendControls}>
      <span className={css.caption} role="status">{t('zoomView', { start: clock(view.first), end: clock(view.last) })}</span>
      <span className={css.caption}>{t('wheelZoom')}</span>
      <button className={css.secondary} type="button" disabled={zoom === undefined} onClick={() => {
        setViewing(previous => ({ ...previous, zoom: undefined }))
      }}>{t('trendZoomReset')}</button>
    </div>
    {plots.map(plot => <TrendPlot key={plot.key} plot={plot} view={view} cursor={activeCursor} maxSpan={maxSpan}
      select={second => { setViewing(previous => ({ ...previous, cursor: second })) }} t={t} />)}
    <div className={css.trendTimeline}>
      <div className={css.timeTicks} aria-hidden="true">
        {[0, .25, .5, .75, 1].map(part => <span key={part}>{clock(Math.round(view.first + span * part))}</span>)}
      </div>
      <div className={css.sliderTrack}>
        <input type="range" min={view.first} max={view.last} step="1" value={cursor ?? view.first}
          disabled={span === 0} aria-label={t('inspectTime')} aria-valuetext={clock(cursor ?? view.first)}
          aria-keyshortcuts="Plus -"
          onFocus={() => { setViewing(previous => previous.cursor === undefined ? { ...previous, cursor: view.first } : previous) }}
          onChange={event => {
            const second = event.currentTarget.valueAsNumber
            setViewing(previous => ({ ...previous, cursor: second }))
          }}
          onKeyDown={event => {
            if (event.key !== '+' && event.key !== '-') return
            event.preventDefault()
            zoomAt(event.key === '+' ? 0.75 : 1 / 0.75)
          }} />
      </div>
    </div>
  </div>
}

