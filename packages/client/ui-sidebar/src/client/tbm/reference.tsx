import { useEffect, useRef, useState } from 'react'
import { numeric, record, rows, text, type Data } from './contracts.ts'
import { continueInChat, FileLink, number, percent, Section, Stat, timestamp, windowLabel, type ResultProps, type Translate } from './display.tsx'
import css from './TbmPanel.module.css'

type CutterDimension = 'position' | 'reason' | 'date'
type CutterFilter = Partial<Record<CutterDimension, string>>
type Count = readonly [name: string, count: number]

function counts(items: readonly Data[], dimension: CutterDimension): Count[] {
  const result = new Map<string, number>()
  for (const item of items) {
    const value = text(item[dimension])
    if (value) result.set(value, (result.get(value) ?? 0) + 1)
  }
  return [...result].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'zh-CN', { numeric: true }))
}

function matches(item: Data, filter: CutterFilter, except?: CutterDimension): boolean {
  return (['position', 'reason', 'date'] as const).every(dimension =>
    dimension === except || filter[dimension] === undefined || text(item[dimension]) === filter[dimension])
}

function HorizontalBars({ entries, position, tones, selected, select, t }: {
  entries: Count[]; position?: boolean; tones?: Data; selected: string | undefined; select: (key: string, trigger: HTMLElement) => void; t: Translate
}) {
  const [expanded, setExpanded] = useState(false)
  const limit = position && !expanded ? 6 : entries.length
  const max = Math.max(1, ...entries.map(([, count]) => count ?? 0))
  const total = entries.reduce((sum, [, count]) => sum + count, 0)
  return <>
    {entries.length === 0 && <p className={css.caption}>{t('empty')}</p>}
    <div className={css.hBars}>
      {entries.slice(0, limit).map(([key, count]) => {
        const label = position ? t('positionName', { position: key }) : key
        const value = position ? `${number(count)} ${t('times')}` : `${number(count)} · ${percent(count / total)}`
        return <button className={css.hBarButton} type="button" key={key} aria-pressed={selected === key}
          title={`${label} · ${value}`} onClick={event => { select(key, event.currentTarget) }}>
          <span>{label}</span>
          <span className={css.hBarTrack} aria-hidden="true"><i data-tone={position ? 'measured' : text(tones?.[key]) || 'other'} style={{ width: `${count / max * 100}%` }} /></span>
          <strong>{value}</strong>
        </button>
      })}
    </div>
    {position && entries.length > 6 && <button className={css.secondary} type="button" onClick={() => { setExpanded(!expanded) }}>
      {expanded ? t('showTopPositions') : t('showAllPositions', { count: String(entries.length) })}
    </button>}
  </>
}

function TreatmentDays({ entries, selected, select, t }: { entries: readonly (readonly [string, number | undefined])[]; selected: string | undefined; select: (key: string, trigger: HTMLElement) => void; t: Translate }) {
  const max = Math.max(1, ...entries.map(([, count]) => count ?? 0))
  return <div className={css.bars} aria-label={t('eventsChart')}>
    {entries.map(([key, count]) => {
      const label = `${key} · ${count === undefined ? t('noLedgerDate') : `${number(count)} ${t('times')}`}`
      return <button className={css.barButton} type="button" key={key} aria-pressed={selected === key}
        disabled={!count} aria-label={label} title={label} onClick={event => { select(key, event.currentTarget) }}>
        <span className={css.barValue}>{number(count)}</span>
        <span className={css.stackTrack}><span data-tone="measured" style={{ height: `${(count ?? 0) / max * 100}%` }} /></span>
        <span className={css.barDate}>{key.slice(5)}</span>
      </button>
    })}
  </div>
}

function CutterCharts(props: ResultProps) {
  const { result, t, fileUrl } = props
  const data = result.data
  const details = rows(data.details)
  const [filter, setFilter] = useState<CutterFilter>({})
  const [showDetails, setShowDetails] = useState(false)
  const [visible, setVisible] = useState(24)
  const detailHeading = useRef<HTMLHeadingElement>(null)
  const detailTrigger = useRef<HTMLElement | null>(null)
  useEffect(() => {
    if (!showDetails) return
    detailHeading.current?.scrollIntoView({ block: 'nearest' })
    detailHeading.current?.focus({ preventScroll: true })
  }, [showDetails, filter])
  const select = (dimension: CutterDimension, key: string, trigger: HTMLElement) => {
    detailTrigger.current = trigger
    setFilter(previous => ({ ...previous, [dimension]: previous[dimension] === key ? undefined : key }))
    setShowDetails(true)
    setVisible(24)
  }
  const clear = () => { setFilter({}); setVisible(24) }
  const detailRows = details.filter(item => matches(item, filter))
  const positions = counts(details.filter(item => matches(item, filter, 'position')), 'position')
  const reasons = counts(details.filter(item => matches(item, filter, 'reason')), 'reason')
  const windowStart = Date.parse(text(record(data.window).start).slice(0, 10))
  const windowEnd = Date.parse(text(record(data.window).end).slice(0, 10))
  const recordedDates = new Map(counts(details, 'date'))
  const filteredDates = new Map(counts(details.filter(item => matches(item, filter, 'date')), 'date'))
  const dates = Array.from({ length: Math.min(7, (windowEnd - windowStart) / 86400000) }, (_, index) => {
    const date = new Date(windowStart + index * 86400000).toISOString().slice(0, 10)
    return [date, recordedDates.has(date) ? filteredDates.get(date) ?? 0 : undefined] as const
  })
  const window = windowLabel(data.window, t)
  const source = record(data.source)
  const coverage = text(record(data.coverage).message)
  const unassigned = rows(record(data.quality).date_unassigned).length
  const limitDate = details.some(item => item.date === props.selectedDate) ? props.selectedDate : text(details.at(-1)?.date)
  const filterLabels = [filter.position && t('positionName', { position: filter.position }), filter.reason, filter.date].filter(Boolean).join(' · ')
  return <>
    <div className={css.chartGrid}>
      <Section title={t('positionsChart')}>
        <HorizontalBars entries={positions} position selected={filter.position} select={(key, trigger) => { select('position', key, trigger) }} t={t} />
      </Section>
      <Section title={t('reasons')} meta={t('reasonBasis')}>
        <HorizontalBars entries={reasons} tones={record(record(data.figure_style).cutter_reason_tones)} selected={filter.reason} select={(key, trigger) => { select('reason', key, trigger) }} t={t} />
      </Section>
    </div>
    <Section title={t('eventsChart')} meta={t('cutterDaysNote')}>
      {dates.length > 0 ? <TreatmentDays entries={dates} selected={filter.date} select={(key, trigger) => { select('date', key, trigger) }} t={t} /> : <p className={css.caption}>{t('empty')}</p>}
      <div className={css.sectionFoot}>
        <button type="button" className={css.secondary} aria-expanded={showDetails} onClick={event => { detailTrigger.current = event.currentTarget; setShowDetails(!showDetails) }}>{t(showDetails ? 'closeDetail' : 'details')}</button>
        {limitDate && <button className={css.secondary} type="button" onClick={() => { props.openConditions({ date: limitDate, focus: 'limits' }) }}>{t('openLimits')} · {limitDate}</button>}
      </div>
    </Section>
    {showDetails && <Section title={t('cutterDetails')} headingRef={detailHeading} meta={`${filterLabels || t('allTreatments')} · ${detailRows.length} ${t('recordsUnit')}`}>
      <button className={css.secondary} type="button" onClick={() => { setShowDetails(false); detailTrigger.current?.focus() }}>{t('closeDetail')}</button>
      {filterLabels && <button className={css.secondary} type="button" onClick={clear}>{t('clearFilters')}</button>}
      {detailRows.length === 0 ? <p className={css.caption}>{t('empty')}</p> : <div className={css.tableScroll}>
        <table><thead><tr><th>{t('date')}</th><th>{t('position')}</th><th>{t('reason')}</th><th>{t('evidenceLines')}</th></tr></thead>
          <tbody>{detailRows.slice(0, visible).map((item, index) => <tr key={text(item.entry_id) || index}>
            <td>{timestamp(item.date)}</td><th scope="row">{text(item.position)}</th><td>{text(item.reason)}</td><td>{text(item.excel_row)}</td>
          </tr>)}</tbody>
        </table>
      </div>}
      {visible < detailRows.length && <button className={css.secondary} type="button" onClick={() => { setVisible(visible + 24) }}>{t('moreRecords', { count: String(Math.min(24, detailRows.length - visible)) })}</button>}
      <div className={css.sectionFoot}>
        <p className={css.caption}>{[text(source.file), text(source.sheet), `${t('ledgerCutoff')} · ${timestamp(data.ledger_cutoff) || '—'}`, unassigned > 0 ? `${t('missingDates')} ${unassigned} ${t('recordsUnit')}` : ''].filter(Boolean).join(' · ')}</p>
        <button className={css.secondary} type="button" onClick={() => { continueInChat(props, [window, coverage, filterLabels, `${t('treatments')} ${detailRows.length}`, ...detailRows.slice(0, 6).map(item => `${text(item.date)} ${text(item.position)} ${text(item.reason)} ${text(item.excel_row)}`)]) }}>{t('openDraft')}</button>
        <FileLink fileUrl={fileUrl} path={record(data.report).path}>{t('downloadReport')}</FileLink>
      </div>
    </Section>}
  </>
}

export function Cutters(props: ResultProps) {
  const { result, t } = props
  const data = result.data
  const summary = record(data.summary)
  const start = text(record(data.window).start).slice(0, 10)
  const end = text(record(data.window).end).slice(0, 10)
  const coverage = text(record(data.coverage).message)
  if (Object.keys(summary).length === 0) return <p className={css.empty}>{t('empty')}</p>
  return <div className={css.content}>
    <div className={css.stats}>
      <Stat label={t('records')} value={`${number(summary.raw_record_count)} ${t('recordsUnit')}`} note={t('dateRangeExclusive', { start, end })} />
      <Stat label={t('treatments')} value={`${number(summary.position_treatment_count)} ${t('times')}`} />
      <Stat label={t('cutterPositions')} value={number(summary.distinct_position_count)} />
    </div>
    {coverage && <p className={css.notice}>{coverage}</p>}
    {numeric(summary.position_treatment_count) !== 0 && <CutterCharts key={`${start}/${end}`} {...props} />}
  </div>
}

function keepEvidenceNote(note: string): boolean {
  return !/标准现行、废止及替代关系待核验|^标准有效状态尚未外部核验[。]?$/u.test(note.trim())
}

function words(value: unknown): string[] {
  return Array.isArray(value) ? value.map(item => text(item)).filter(Boolean) : []
}

function EvidenceItem({ item, kind, props }: { item: Data; kind: 'standard' | 'case'; props: ResultProps }) {
  const { t, fileUrl } = props
  const metadata = record(item.metadata)
  const citation = record(item.citation)
  const project = record(metadata.project)
  const isStandard = kind === 'standard'
  const title = isStandard ? [text(metadata.number), text(metadata.name)].filter(Boolean).join(' · ') : text(project.project_name ?? metadata.project_name)
  const quote = isStandard ? text(item.text) : text(record(metadata.event).problem_description)
  const locator = text(citation.locator)
  const location = isStandard ? locator : typeof metadata.event_index === 'number'
    ? t('caseEvent', { number: String(metadata.event_index + 1) }) : ''
  const validity = record(metadata.library_validity)
  const libraryLabel = isStandard && validity.status === 'current' ? text(validity.label) : ''
  const notes = [...new Set([...words(item.applicability_notes), ...words(item.differences), ...words(item.warnings)])].filter(keepEvidenceNote)
  const scope = text(metadata.scope)
  return <article className={css.evidenceCard}>
    <div className={css.chips}>
      <span className={css.tag}>{isStandard ? text(metadata.standard_type) || t('candidate') : t('caseLead')}</span>
      {location && <span className={css.caption}>{location}</span>}
      {libraryLabel && <span className={css.tag} data-current>{libraryLabel}</span>}
    </div>
    <h3>{title || t(kind)}</h3>
    {quote.length > 300 ? <>
      <p className={css.quote}>{quote.slice(0, 300)}…</p>
      <details className={css.details}><summary>{t('quote')}</summary><p className={css.quote}>{quote}</p></details>
    </> : <p className={css.quote}>{quote}</p>}
    {(scope || notes.length > 0) && <details className={css.details}>
      <summary>{t('applicability')}</summary>
      {scope && <p className={css.quote}>{scope}</p>}
      {notes.length > 0 && <ul>{notes.map(note => <li key={note}>{note}</li>)}</ul>}
    </details>}
    <div className={css.sectionFoot}>
      {text(citation.source_url)
        ? <FileLink fileUrl={fileUrl} path={citation.source_url}>{t(isStandard ? 'openPdf' : 'openCase')}</FileLink>
        : isStandard && <span className={css.caption}>{t('pdfUnavailable')}</span>}
      <button className={css.secondary} type="button" onClick={() => { continueInChat(props, [title, libraryLabel, location, quote, text(citation.markdown_link), ...notes]) }}>{t('openDraft')}</button>
    </div>
  </article>
}

function libraryToken(value: string) {
  return value.normalize('NFKC').replace(/[\s_\/\-–—]+/gu, '').toLowerCase()
}

export function StandardLibrary({ documents, fileUrl, t }: Pick<ResultProps, 'fileUrl' | 't'> & { documents: readonly Data[] }) {
  const [keyword, setKeyword] = useState('')
  const [category, setCategory] = useState('')
  const [visible, setVisible] = useState(15)
  const categories = [...new Set(documents.map(item => text(item.category)).filter(Boolean))]
  const tokens = keyword.trim().split(/\s+/u).map(libraryToken).filter(Boolean)
  const results = documents.filter(item => {
    const haystack = libraryToken([item.number, item.title, item.type, item.region, item.category].map(text).join(' '))
    return (!category || item.category === category) && tokens.every(token => haystack.includes(token))
  })
  return <section className={css.library} aria-labelledby="tbm-standard-library">
    <header className={css.libraryHeader}>
      <div><h2 id="tbm-standard-library">{t('standardLibrary')}</h2>
        <span className={css.caption} aria-live="polite">{t('libraryCount', { found: String(results.length), total: String(documents.length) })}</span></div>
      <div className={css.filters}>
        <label><span>{t('librarySearch')}</span><input type="search" placeholder={t('librarySearchHint')} value={keyword}
          onChange={event => { setKeyword(event.target.value); setVisible(15) }} /></label>
        <label><span>{t('libraryCategory')}</span><select value={category}
          onChange={event => { setCategory(event.target.value); setVisible(15) }}>
          <option value="">{t('allLibraryCategories')}</option>
          {categories.map(value => <option key={value}>{value}</option>)}
        </select></label>
      </div>
    </header>
    {results.length === 0 ? <p className={css.caption}>{t(documents.length ? 'noLibraryMatches' : 'emptyLibrary')}</p> : <>
      <ul className={css.libraryList}>
        {results.slice(0, visible).map(item => {
          const id = text(item.id)
          const number = text(item.number)
          const title = text(item.title)
          const url = fileUrl(`/api/tbm/evidence-source?pdf=${id}`)
          return <li key={id}>
            <a className={css.libraryRow} href={url} target="_blank" rel="noopener noreferrer">
              <span className={css.documentBadge} aria-hidden="true">PDF</span>
              <span className={css.documentTitle}><strong>{title}</strong><span>{[number, item.type, item.region].map(text).filter(Boolean).join(' · ')}</span></span>
              <span className={css.documentOpen}>{t('openPdf')}</span>
            </a>
          </li>
        })}
      </ul>
      {visible < results.length && <button type="button" className={css.secondary} onClick={() => { setVisible(visible + 15) }}>{t('morePdfs')}</button>}
    </>}
  </section>
}

export function Evidence(props: ResultProps) {
  const { result, t } = props
  const standards = rows(result.data.standards)
  const cases = rows(result.data.cases)
  const gaps = words(result.data.evidence_gaps).filter(keepEvidenceNote)
  if (standards.length === 0 && cases.length === 0) return <div className={css.empty} role="status">
    <strong>{t('noEvidence')}</strong>{gaps.length > 0 && <ul>{gaps.map(gap => <li key={gap}>{gap}</li>)}</ul>}
  </div>
  return <div className={css.content}>
    {standards.length > 0 && <Section title={t('standards')}>
      {standards.map((item, index) => <EvidenceItem key={text(item.evidence_id) || index} item={item} kind="standard" props={props} />)}
    </Section>}
    {cases.length > 0 && <Section title={t('cases')}>
      {cases.map((item, index) => <EvidenceItem key={text(item.evidence_id) || index} item={item} kind="case" props={props} />)}
    </Section>}
    {gaps.length > 0 && <Section title={t('sourceNotes')}><ul>{gaps.map(gap => <li key={gap}>{gap}</li>)}</ul></Section>}
  </div>
}
